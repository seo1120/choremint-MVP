import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ParentTabNav from '../../components/ParentTabNav';
import { initializePushNotifications } from '../../lib/pushNotifications';

interface Family {
  id: string;
  family_code: string;
  family_name?: string;
}

interface Child {
  id: string;
  nickname: string;
  points: number;
  avatar_url?: string;
}


export default function ParentHome() {
  const [family, setFamily] = useState<Family | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [weeklyPoints, setWeeklyPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddChild, setShowAddChild] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [newPin, setNewPin] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [familyNameOnboarding, setFamilyNameOnboarding] = useState('');
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  // 푸시 알림 초기화
  useEffect(() => {
    const initPush = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // 부모 로그인 시 푸시 알림 구독
        await initializePushNotifications(session.user.id, false);
      }
    };
    initPush();
  }, []);

  useEffect(() => {
    if (!family) return;
    
    // Subscribe to new submissions with family_id filter
    const submissionsChannel = supabase
      .channel('parent-home-submissions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'submissions',
          filter: `family_id=eq.${family.id}`,
        },
        (payload) => {
          console.log('New submission received:', payload);
          loadSubmissions(family.id);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to submissions');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Channel error:', status);
        }
      });

    // Subscribe to points_ledger updates to refresh children points
    const pointsLedgerChannel = supabase
      .channel('parent-home-points-updates')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE 모두 감지
          schema: 'public',
          table: 'points_ledger',
        },
        (payload) => {
          console.log('Points ledger updated:', payload);
          // 포인트가 변경되면 데이터 다시 로드
          loadData();
        }
      )
      .subscribe();

    // Subscribe to families table updates (for family_name changes)
    const familiesChannel = supabase
      .channel('parent-home-families-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'families',
          filter: `id=eq.${family.id}`,
        },
        (payload) => {
          console.log('Family updated:', payload);
          // family_name이 변경되면 데이터 다시 로드
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(submissionsChannel);
      supabase.removeChannel(pointsLedgerChannel);
      supabase.removeChannel(familiesChannel);
    };
  }, [family]);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate('/');
      return;
    }

    try {
      console.log('Loading family for user:', session.user.id);
      // Load family with family_name
      const { data: familyData, error: familyError } = await supabase
        .from('families')
        .select('id, family_code, family_name')
        .eq('parent_id', session.user.id)
        .single();
      
      console.log('Family query result:', { familyData, familyError });

      if (familyError) {
        console.error('Error loading family:', familyError);
        
        // PGRST116 에러는 데이터가 없다는 의미이므로 가족 생성 시도
        if (familyError.code === 'PGRST116') {
          console.log('Family not found, creating new family...');
        } else {
          console.error('Unexpected error loading family:', familyError);
          alert(`가족 정보를 불러오는 중 오류가 발생했습니다: ${familyError.message}`);
          setLoading(false);
          return;
        }
        
        // Try to create family if it doesn't exist
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          console.log('Calling ensure_family_exists RPC...');
          const { data: newFamilyId, error: createError } = await supabase.rpc(
            'ensure_family_exists',
            { user_id: currentSession.user.id }
          );
          
          console.log('RPC result:', { newFamilyId, createError });
          if (createError) {
            console.error('Error creating family:', createError);
            // Fallback: Try to create family manually
            const familyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const { data: newFamily, error: insertError } = await supabase
              .from('families')
              .insert({
                parent_id: currentSession.user.id,
                family_code: familyCode,
              })
              .select()
              .single();
            
            if (insertError) {
              console.error('Error creating family manually:', insertError);
              setLoading(false);
              return;
            }
            
            if (newFamily) {
              setFamily(newFamily);
              await loadChildrenAndData(newFamily.id);
              setLoading(false);
              return;
            }
          } else if (newFamilyId) {
            // Reload family
            const { data: reloadedFamily, error: reloadError } = await supabase
              .from('families')
              .select('*')
              .eq('parent_id', session.user.id)
              .single();
            
            if (reloadError) {
              console.error('Error reloading family:', reloadError);
              setLoading(false);
              return;
            }
            
            if (reloadedFamily) {
              setFamily(reloadedFamily);
              await loadChildrenAndData(reloadedFamily.id);
              setLoading(false);
              return;
            }
          }
        }
        setLoading(false);
        return;
      }

      if (familyData) {
        console.log('Family found:', familyData);
        setFamily(familyData);
        
        // Check if profile exists
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .single();

        if (!profileData) {
          // Show onboarding modal
          setShowOnboarding(true);
          setLoading(false);
          return;
        }

        await loadChildrenAndData(familyData.id);
      } else {
        console.log('Family data is null, trying to create...');
        // Family doesn't exist, try to create
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          const { data: newFamilyId, error: createError } = await supabase.rpc(
            'ensure_family_exists',
            { user_id: currentSession.user.id }
          );
          if (createError) {
            console.error('RPC create error:', createError);
            // Fallback: manual creation
            const familyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const { data: newFamily, error: insertError } = await supabase
              .from('families')
              .insert({
                parent_id: currentSession.user.id,
                family_code: familyCode,
              })
              .select()
              .single();
            
            if (insertError) {
              console.error('Manual create error:', insertError);
              alert(`가족 생성 중 오류가 발생했습니다: ${insertError.message}`);
            } else if (newFamily) {
              setFamily(newFamily);
              await loadChildrenAndData(newFamily.id);
            }
          } else if (newFamilyId) {
            const { data: reloadedFamily, error: reloadError } = await supabase
              .from('families')
              .select('*')
              .eq('parent_id', session.user.id)
              .single();
            
            if (reloadError) {
              console.error('Reload error:', reloadError);
            } else if (reloadedFamily) {
              setFamily(reloadedFamily);
              await loadChildrenAndData(reloadedFamily.id);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadChildrenAndData = async (familyId: string) => {
    try {
      console.log('Loading children for family:', familyId);
      // Load children with points from child_points_view
      const { data: childrenData, error: childrenError } = await supabase
        .from('children')
        .select('id, nickname, family_id, created_at, avatar_url, goal_points, reward')
        .eq('family_id', familyId)
        .order('created_at', { ascending: false });

      if (childrenError) {
        console.error('Error loading children:', childrenError);
        setChildren([]);
      } else if (childrenData && childrenData.length > 0) {
        // Get points from child_points_view
        const childIds = childrenData.map(c => c.id);
        const { data: pointsData } = await supabase
          .from('child_points_view')
          .select('child_id, total_points')
          .in('child_id', childIds);
        
          // Merge points data with children data
          let childrenWithPoints: Child[] = [];
          if (pointsData) {
            const pointsMap = new Map(pointsData.map(p => [p.child_id, p.total_points]));
            childrenWithPoints = childrenData.map(child => ({
              id: child.id,
              nickname: child.nickname,
              points: pointsMap.get(child.id) || 0,
              avatar_url: child.avatar_url,
            }));
          } else {
            childrenWithPoints = childrenData.map(child => ({
              id: child.id,
              nickname: child.nickname,
              points: 0,
              avatar_url: child.avatar_url,
            }));
          }
        
        console.log('Children loaded:', childrenWithPoints.length);
        setChildren(childrenWithPoints);
      } else {
        console.log('No children found');
        setChildren([]);
      }

      // Load pending submissions
      await loadSubmissions(familyId);
      
      // Load weekly points (will be called again in useEffect when children are loaded)
    } catch (error) {
      console.error('Error loading children and data:', error);
      alert(`데이터를 불러오는 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
  };

  const loadSubmissions = async (familyId?: string) => {
    if (!familyId && !family) return;
    
    try {
      const { data, error } = await supabase
        .from('submissions')
        .select('id')
        .eq('family_id', familyId || family!.id)
        .eq('status', 'pending');

      if (error) {
        console.error('Error loading submissions:', error);
        setPendingCount(0);
        return;
      }

      if (data) {
        setPendingCount(data.length);
      } else {
        setPendingCount(0);
      }
    } catch (error) {
      console.error('Error loading submissions:', error);
      setPendingCount(0);
    }
  };

  const loadWeeklyPoints = async () => {
    if (children.length === 0) {
      setWeeklyPoints(0);
      return;
    }
    
    try {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const childIds = children.map(c => c.id);
      if (childIds.length === 0) {
        setWeeklyPoints(0);
        return;
      }

      const { data, error } = await supabase
        .from('points_ledger')
        .select('delta')
        .gte('created_at', startOfWeek.toISOString())
        .in('child_id', childIds);

      if (error) {
        console.error('Error loading weekly points:', error);
        setWeeklyPoints(0);
        return;
      }

      if (data) {
        const total = data.reduce((sum, item) => sum + item.delta, 0);
        setWeeklyPoints(total);
      } else {
        setWeeklyPoints(0);
      }
    } catch (error) {
      console.error('Error loading weekly points:', error);
      setWeeklyPoints(0);
    }
  };

  useEffect(() => {
    if (children.length > 0 && family) {
      loadWeeklyPoints();
    }
  }, [children, family]);

  const copyFamilyCode = () => {
    if (family?.family_code) {
      navigator.clipboard.writeText(family.family_code);
      alert('Family code copied!');
    }
  };

  const handleOnboardingSubmit = async () => {
    if (!familyNameOnboarding.trim() || !family) return;
    
    setSavingOnboarding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Create profile with email username as default name
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: session.user.id,
          name: session.user.email?.split('@')[0] || 'Parent',
          role: 'parent',
          family_id: family.id,
          notif_opt_in: true,
        });

      if (profileError) throw profileError;

      // Update family_name
      const { error: familyError } = await supabase
        .from('families')
        .update({ family_name: familyNameOnboarding.trim() })
        .eq('id', family.id);

      if (familyError) throw familyError;

      setShowOnboarding(false);
      // Reload data
      await loadData();
    } catch (error: any) {
      console.error('Error saving onboarding:', error);
      alert('Error occurred while saving: ' + error.message);
    } finally {
      setSavingOnboarding(false);
    }
  };

  const handleAddChild = async () => {
    if (!newNickname || !newPin) {
      alert('Please enter both nickname and PIN.');
      return;
    }

    setAddingChild(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Login required.');

      if (!family) throw new Error('Family information not found.');

      const { error } = await supabase
        .from('children')
        .insert({
          family_id: family.id,
          nickname: newNickname,
          pin: newPin,
          points: 0,
        });

      if (error) throw error;

      setNewNickname('');
      setNewPin('');
      setShowAddChild(false);
      loadData();
    } catch (error: any) {
      alert(error.message || 'Error occurred while adding child.');
    } finally {
      setAddingChild(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
          <p className="text-sm text-gray-500 mt-2">Please wait</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Onboarding Modal */}
      {showOnboarding && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-xl p-6 max-w-md w-full">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              Welcome! 👋
            </h2>
            <p className="text-gray-600 mb-6">
              Please set your family name to get started.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Family Name *
                </label>
                <input
                  type="text"
                  value={familyNameOnboarding}
                  onChange={(e) => setFamilyNameOnboarding(e.target.value)}
                  placeholder="e.g., Smith"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5CE1C6]"
                />
                <p className="text-xs text-gray-500 mt-1">
                  This will appear as "~'s Home" on the home page
                </p>
              </div>
              
              <button
                onClick={handleOnboardingSubmit}
                disabled={savingOnboarding || !familyNameOnboarding.trim()}
                className="w-full px-6 py-3 bg-[#5CE1C6] text-white rounded-lg hover:bg-[#4BC9B0] transition-colors disabled:opacity-50 font-bold"
              >
                {savingOnboarding ? 'Saving...' : 'Get Started'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto p-3 sm:p-4">
        {/* Children Avatar Tabs */}
        {children.length > 0 && (
          <div className="mb-4 flex gap-3 overflow-x-auto pb-2">
            {children.map((child) => (
              <div
                key={child.id}
                className="flex flex-col items-center gap-2 min-w-[80px] cursor-pointer"
                onClick={() => {
                  // Navigate to child settings page
                  navigate(`/parent/child/${child.id}/settings`);
                }}
              >
                <div className="w-16 h-16 rounded-full border-2 border-[#5CE1C6] overflow-hidden bg-gradient-to-br from-orange-400 to-pink-400 flex items-center justify-center">
                  {child.avatar_url ? (
                    <img
                      src={child.avatar_url}
                      alt={child.nickname}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-bold text-white">
                      {child.nickname[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium text-gray-700 text-center max-w-[80px] truncate">
                  {child.nickname}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Header */}
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 text-center mb-4 sm:mb-6 pt-6 sm:pt-8">
          {family?.family_name ? `${family.family_name}'s Home` : 'Home'}
        </h1>
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-gray-600 text-sm mt-1">Family Code: 
                <span className="font-mono font-bold ml-2">{family?.family_code || 'Loading...'}</span>
              </p>
            </div>
            <button
              onClick={copyFamilyCode}
              className="px-4 py-2 bg-[#5CE1C6] text-white rounded-lg hover:bg-[#4BC9B0] transition-colors text-sm"
            >
              Copy
            </button>
          </div>
          <button
            onClick={() => setShowAddChild(!showAddChild)}
            className="w-full px-4 py-2 bg-gradient-to-r from-[#FF7F7F] to-[#FFB6C1] text-white rounded-lg hover:from-[#FF6B6B] hover:to-[#FFA5B0] transition-colors text-sm font-medium"
          >
            {showAddChild ? 'Cancel' : '+ Add Child'}
          </button>
          {showAddChild && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <input
                type="text"
                placeholder="Nickname"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5CE1C6]"
              />
              <input
                type="text"
                placeholder="PIN"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5CE1C6]"
              />
              <button
                onClick={handleAddChild}
                disabled={addingChild}
                className="w-full px-4 py-2 bg-[#5CE1C6] text-white rounded-lg hover:bg-[#4BC9B0] transition-colors disabled:opacity-50"
              >
                {addingChild ? 'Adding...' : 'Add'}
              </button>
            </div>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Pending Approvals */}
          <div 
            onClick={() => navigate('/parent/approvals')}
            className="bg-gradient-to-br from-[#5CE1C6] to-[#4BC9B0] rounded-2xl shadow-lg p-6 cursor-pointer hover:shadow-xl transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm mb-1 opacity-90">Pending</p>
                <p className="text-3xl font-bold text-white">{pendingCount}</p>
              </div>
            </div>
          </div>

          {/* Weekly Points */}
          <div className="bg-gradient-to-br from-[#FF7F7F] to-[#FFB6C1] rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm mb-1 opacity-90">Weekly Total</p>
                <p className="text-3xl font-bold text-white">{weeklyPoints} pts</p>
              </div>
            </div>
          </div>
        </div>

        {/* Children Progress */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Children Progress</h2>
          {children.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No children registered.</p>
          ) : (
            <div className="space-y-4">
              {children.map((child) => {
                const progress = Math.min(100, (child.points / 100) * 100); // Example: 100 points = 100%
                return (
                  <div key={child.id} id={`child-${child.id}`} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-800">{child.nickname}</span>
                      <span className="text-sm text-gray-600">{child.points} pts</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-[#5CE1C6] h-3 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <ParentTabNav />
    </div>
  );
}


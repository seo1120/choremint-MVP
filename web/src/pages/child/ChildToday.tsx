import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';
import Icon from '../../components/Icon';
import { initializePushNotifications } from '../../lib/pushNotifications';

interface ChoreStep {
  order: number;
  description: string;
}

interface ChoreAssignment {
  id: string;
  chore_id: string;
  due_date: string;
  status: string;
  chore: {
    id: string;
    title: string;
    points: number;
    photo_required: boolean;
    steps?: ChoreStep[];
    icon?: string;
  };
}

interface ChildSession {
  childId: string;
  nickname: string;
  points: number;
  familyId: string;
}

export default function ChildToday() {
  const [assignments, setAssignments] = useState<ChoreAssignment[]>([]);
  const [childSession, setChildSession] = useState<ChildSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [level, setLevel] = useState(1);
  const [exp, setExp] = useState(0);
  const [nextLevelExp, setNextLevelExp] = useState(100);
  const [characterMood, setCharacterMood] = useState<'happy' | 'normal' | 'sleepy'>('happy');
  const [selectedAssignment, setSelectedAssignment] = useState<ChoreAssignment | null>(null);
  const [showChoreDetail, setShowChoreDetail] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const session = localStorage.getItem('child_session');
    if (!session) {
      navigate('/');
      return;
    }

    let parsedSession: ChildSession;
    try {
      parsedSession = JSON.parse(session);
        setChildSession(parsedSession);
      calculateLevel(parsedSession.points);
        loadAssignments(parsedSession.childId);
      // 초기 로드 시 최신 포인트 가져오기
      loadLatestPoints(parsedSession.childId);
      
      // 자녀 로그인 시 푸시 알림 구독
      initializePushNotifications(parsedSession.childId, true);
      } catch (e) {
      navigate('/');
      return;
    }

    // Subscribe to new chore assignments for this child
    const assignmentsChannel = supabase
      .channel('child-assignments-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chore_assignments',
          filter: `child_id=eq.${parsedSession.childId}`,
        },
        (payload) => {
          console.log('New assignment received:', payload);
          // Reload assignments when new one is created
          loadAssignments(parsedSession.childId);
        }
      )
      .subscribe();

    // Subscribe to submission status updates (해당 자녀의 제출물만)
    const submissionsChannel = supabase
      .channel('child-submissions-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
          filter: `child_id=eq.${parsedSession.childId}`,
        },
        (payload) => {
          if (payload.new.status === 'approved') {
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 3000);
            // 포인트는 children 테이블 업데이트로 자동 갱신됨
          }
        }
      )
      .subscribe();

    // Subscribe to points_ledger updates (포인트 실시간 갱신)
    // child_points_view는 뷰이므로 직접 구독할 수 없으므로 points_ledger를 구독
    const pointsLedgerChannel = supabase
      .channel('child-points-updates')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE 모두 감지
          schema: 'public',
          table: 'points_ledger',
          filter: `child_id=eq.${parsedSession.childId}`,
        },
        (payload) => {
          console.log('Points ledger updated:', payload);
          // 포인트 내역이 변경되면 최신 포인트 다시 로드
          loadLatestPoints(parsedSession.childId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(submissionsChannel);
      supabase.removeChannel(pointsLedgerChannel);
    };
  }, [navigate]);

  const loadAssignments = async (childId: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      console.log('Loading assignments for child:', childId, 'on date:', today);
      
      // First, check if we can query the table at all
      const { data: testData, error: testError } = await supabase
        .from('chore_assignments')
        .select('id')
        .eq('child_id', childId)
        .limit(1);
      
      console.log('Test query result:', { testData, testError });
      
      // Load all pending assignments (not just today's)
      const { data, error } = await supabase
        .from('chore_assignments')
        .select(`
          *,
          chore:chores(
            id,
            title,
            points,
            photo_required,
            active,
            steps,
            icon
          )
        `)
        .eq('child_id', childId)
        .eq('status', 'todo')
        .gte('due_date', today) // Show assignments due today or in the future
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading assignments:', error);
        console.error('Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
      } else {
        console.log('Loaded assignments:', data);
        console.log('Number of assignments:', data?.length || 0);
        setAssignments(data as ChoreAssignment[]);
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLatestPoints = async (childId: string) => {
    try {
      // Use child_points_view for real-time accurate points from points_ledger
      const { data } = await supabase
        .from('child_points_view')
        .select('total_points')
        .eq('child_id', childId)
        .single();

      if (data) {
        const session = localStorage.getItem('child_session');
        if (session) {
          try {
            const parsedSession: ChildSession = JSON.parse(session);
            const updatedSession = { ...parsedSession, points: data.total_points };
            localStorage.setItem('child_session', JSON.stringify(updatedSession));
            setChildSession(updatedSession);
            calculateLevel(data.total_points);
          } catch (e) {
            console.error('Error updating session:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error loading latest points:', error);
    }
  };

  const calculateLevel = (points: number) => {
    // 레벨 계산: 100포인트마다 레벨 1 증가
    const newLevel = Math.floor(points / 100) + 1;
    const currentLevelExp = (newLevel - 1) * 100;
    const currentExp = points - currentLevelExp;
    const nextExp = newLevel * 100 - currentLevelExp;

    setLevel(newLevel);
    setExp(currentExp);
    setNextLevelExp(nextExp);

    // 포인트에 따라 캐릭터 기분 결정
    if (points >= 500) {
      setCharacterMood('happy');
    } else if (points >= 200) {
      setCharacterMood('normal');
    } else {
      setCharacterMood('sleepy');
    }
  };

  const handleUpload = (choreId: string) => {
    navigate(`/child/upload?chore_id=${choreId}`);
  };

  const handleChoreClick = (assignment: ChoreAssignment) => {
    setSelectedAssignment(assignment);
    setShowChoreDetail(true);
  };

  const calculateDaysUntilDue = (dueDate: string): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading || !childSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white pb-20">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Confetti effect */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="text-6xl animate-bounce">🎉</div>
        </div>
      )}
      
      <div 
        className="max-w-md mx-auto"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)',
          paddingBottom: '16px',
          paddingLeft: '16px',
          paddingRight: '16px',
        }}
      >
        {/* 헤더 + 카드들 간격 일정하게 */}
        <div className="space-y-4">
          {/* 헤더: 카드랑 같은 폭/인셋, 배경 없음 */}
          <div className="px-4">
            <h1 className="text-2xl font-bold text-gray-800 mb-3">
              Hi, {childSession.nickname} 👋
            </h1>
            <p className="text-gray-600 text-sm mb-7">
              Complete today&apos;s chores!
            </p>
          </div>

          {/* Character Section */}
          <div className="bg-gradient-to-br from-[#E6F9F5] to-[#D0F4ED] rounded-3xl shadow-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-1">My Character</h2>
              <div className="flex items-center gap-2">
                <Icon name="star" size={16} active={true} />
                <span className="text-sm font-semibold text-gray-700">Level {level}</span>
              </div>
            </div>
            {/* Character SVG (3D-like appearance) */}
            <div className="relative">
              <div className={`transform transition-all duration-500 ${
                characterMood === 'happy' ? 'scale-110 animate-bounce' : 
                characterMood === 'normal' ? 'scale-100' : 'scale-90'
              }`}>
                <svg
                  width="80"
                  height="80"
                  viewBox="0 0 200 200"
                  className="drop-shadow-lg"
                >
                  {/* Body (3D sphere effect) */}
                  <defs>
                    <radialGradient id="bodyGradient" cx="50%" cy="30%">
                      <stop offset="0%" stopColor="#FFD700" />
                      <stop offset="50%" stopColor="#FFA500" />
                      <stop offset="100%" stopColor="#FF8C00" />
                    </radialGradient>
                    <radialGradient id="eyeGradient" cx="50%" cy="30%">
                      <stop offset="0%" stopColor="#FFFFFF" />
                      <stop offset="100%" stopColor="#E0E0E0" />
                    </radialGradient>
                  </defs>
                  
                  {/* Body circle with 3D effect */}
                  <circle
                    cx="100"
                    cy="120"
                    r="60"
                    fill="url(#bodyGradient)"
                    className="drop-shadow-xl"
                  />
                  
                  {/* Highlight for 3D effect */}
                  <ellipse
                    cx="85"
                    cy="100"
                    rx="25"
                    ry="30"
                    fill="rgba(255, 255, 255, 0.4)"
                  />
                  
                  {/* Eyes */}
                  <circle
                    cx="85"
                    cy="110"
                    r="8"
                    fill="url(#eyeGradient)"
                  />
                  <circle
                    cx="115"
                    cy="110"
                    r="8"
                    fill="url(#eyeGradient)"
                  />
                  
                  {/* Pupils */}
                  <circle
                    cx={characterMood === 'happy' ? '88' : '85'}
                    cy="110"
                    r="4"
                    fill="#000"
                  />
                  <circle
                    cx={characterMood === 'happy' ? '118' : '115'}
                    cy="110"
                    r="4"
                    fill="#000"
                  />
                  
                  {/* Mouth */}
                  {characterMood === 'happy' ? (
                    <path
                      d="M 85 125 Q 100 140 115 125"
                      stroke="#000"
                      strokeWidth="3"
                      fill="none"
                      strokeLinecap="round"
                    />
                  ) : characterMood === 'normal' ? (
                    <line
                      x1="90"
                      y1="125"
                      x2="110"
                      y2="125"
                      stroke="#000"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  ) : (
                    <path
                      d="M 85 130 Q 100 120 115 130"
                      stroke="#000"
                      strokeWidth="3"
                      fill="none"
                      strokeLinecap="round"
                    />
                  )}
                  
                  {/* Decorative elements based on level */}
                  {level >= 3 && (
                    <circle
                      cx="100"
                      cy="80"
                      r="15"
                      fill="#FFD700"
                      opacity="0.6"
                    />
                  )}
                  {level >= 5 && (
                    <>
                      <circle cx="70" cy="130" r="8" fill="#FF69B4" opacity="0.7" />
                      <circle cx="130" cy="130" r="8" fill="#FF69B4" opacity="0.7" />
                    </>
                  )}
                </svg>
              </div>
            </div>
          </div>
          
          {/* EXP Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-600">
              <span>EXP: {exp} / {nextLevelExp}</span>
              <span>{Math.round((exp / nextLevelExp) * 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#5CE1C6] to-[#4ECDC4] h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(exp / nextLevelExp) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Today's Chores */}
        {assignments.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
              <p className="text-gray-500 text-lg">No chores today! 🎉</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {assignments.map((assignment) => {
              const daysUntilDue = calculateDaysUntilDue(assignment.due_date);
              const daysText = daysUntilDue === 0 ? 'D-Day' : daysUntilDue > 0 ? `D-${daysUntilDue}` : `D+${Math.abs(daysUntilDue)}`;
              
              return (
                <div
                  key={assignment.id}
                  onClick={() => handleChoreClick(assignment)}
                  className="bg-white rounded-2xl shadow-lg p-4 hover:shadow-xl transition-shadow cursor-pointer"
                >
                  <div className="text-center">
                    <div className="w-16 h-16 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                      {assignment.chore.icon && !assignment.chore.icon.match(/[\u{1F300}-\u{1F9FF}]/u) ? (
                        <Icon name={assignment.chore.icon} size={32} />
                      ) : assignment.chore.icon ? (
                        <span className="text-3xl">{assignment.chore.icon}</span>
                      ) : (
                        <Icon name="chore" size={32} />
                      )}
                    </div>
                    <h3 className="font-bold text-gray-800 mb-2 text-sm">
                      {assignment.chore.title}
                    </h3>
                    <div className="flex items-center justify-center gap-1 mb-2">
                      <Icon name="star" size={16} className="text-yellow-500" />
                      <span className="text-sm font-semibold text-gray-700">
                        {assignment.chore.points} pts
                      </span>
                    </div>
                    <div className="text-xs text-[#5CE1C6] font-semibold">
                      {daysText}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Chore Detail Modal */}
        {showChoreDetail && selectedAssignment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-2xl font-bold text-gray-800 mb-2">
                    {selectedAssignment.chore.title}
                  </h3>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon name="star" size={16} />
                    <span className="text-gray-600">{selectedAssignment.chore.points} points</span>
                    <span className="text-[#5CE1C6] font-semibold ml-2">
                      {(() => {
                        const days = calculateDaysUntilDue(selectedAssignment.due_date);
                        return days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
                      })()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowChoreDetail(false)}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  ×
                </button>
              </div>

              {selectedAssignment.chore.steps && selectedAssignment.chore.steps.length > 0 ? (
                <div className="space-y-3 mb-6">
                  <h4 className="font-semibold text-gray-800 mb-2">Steps:</h4>
                  {selectedAssignment.chore.steps.map((step: any, index: number) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <span className="font-bold text-[#5CE1C6] w-6">{step.order}.</span>
                      <p className="text-gray-700 flex-1">{step.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4 mb-6">No steps defined</p>
              )}

              <button
                onClick={() => {
                  setShowChoreDetail(false);
                  handleUpload(selectedAssignment.chore.id);
                }}
                className="w-full px-4 py-3 bg-gradient-to-r from-orange-400 to-pink-400 text-white rounded-lg hover:from-orange-500 hover:to-pink-500 transition-colors font-bold"
              >
                📸 Upload Photo
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
      <ChildTabNav />
    </div>
  );
}

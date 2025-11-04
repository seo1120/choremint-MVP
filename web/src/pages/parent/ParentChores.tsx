import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ParentTabNav from '../../components/ParentTabNav';

interface Chore {
  id: string;
  title: string;
  points: number;
  photo_required: boolean;
  active: boolean;
}

interface Child {
  id: string;
  nickname: string;
}

export default function ParentChores() {
  const [chores, setChores] = useState<Chore[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [newChoreTitle, setNewChoreTitle] = useState('');
  const [newChorePoints, setNewChorePoints] = useState(10);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate('/parent-login');
      return;
    }

    try {
      // Load family
      const { data: familyData } = await supabase
        .from('families')
        .select('*')
        .eq('parent_id', session.user.id)
        .single();

      if (familyData) {
        // Load chores
        const { data: choresData } = await supabase
          .from('chores')
          .select('*')
          .eq('family_id', familyData.id)
          .eq('active', true)
          .order('created_at', { ascending: false });

        if (choresData) {
          setChores(choresData);
        }

        // Load children
        const { data: childrenData } = await supabase
          .from('children')
          .select('id, nickname')
          .eq('family_id', familyData.id);

        if (childrenData) {
          setChildren(childrenData);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleAddChore = async () => {
    if (!newChoreTitle.trim()) {
      alert('집안일 제목을 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('로그인이 필요합니다.');

      const { data: familyData } = await supabase
        .from('families')
        .select('*')
        .eq('parent_id', session.user.id)
        .single();

      if (!familyData) throw new Error('가족 정보를 찾을 수 없습니다.');

      const { error } = await supabase
        .from('chores')
        .insert({
          family_id: familyData.id,
          title: newChoreTitle,
          points: newChorePoints,
          photo_required: true,
          active: true,
        });

      if (error) throw error;

      setNewChoreTitle('');
      setNewChorePoints(10);
      setShowAddForm(false);
      loadData();
    } catch (error: any) {
      alert(error.message || '집안일 추가 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignToAll = async (choreId: string) => {
    if (children.length === 0) {
      alert('자녀를 먼저 추가해주세요.');
      return;
    }

    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const assignments = children.map(child => ({
        chore_id: choreId,
        child_id: child.id,
        due_date: today,
        status: 'todo',
      }));

      // Use upsert to avoid duplicates
      const { error } = await supabase
        .from('chore_assignments')
        .upsert(assignments, {
          onConflict: 'chore_id,child_id,due_date',
        });

      if (error) throw error;

      alert('모든 자녀에게 할 일이 할당되었습니다!');
    } catch (error: any) {
      alert(error.message || '할당 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pb-20">
      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-800">집안일 관리</h1>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              {showAddForm ? '취소' : '+ 추가'}
            </button>
          </div>

          {showAddForm && (
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <input
                type="text"
                placeholder="집안일 제목"
                value={newChoreTitle}
                onChange={(e) => setNewChoreTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-4">
                <label className="text-sm text-gray-600">포인트:</label>
                <input
                  type="number"
                  value={newChorePoints}
                  onChange={(e) => setNewChorePoints(parseInt(e.target.value) || 10)}
                  min="1"
                  className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleAddChore}
                disabled={loading}
                className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                추가
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {chores.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
              <p className="text-gray-500">등록된 집안일이 없습니다.</p>
            </div>
          ) : (
            chores.map((chore) => (
              <div key={chore.id} className="bg-white rounded-2xl shadow-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">{chore.title}</h3>
                    <p className="text-gray-600 mt-1">⭐ {chore.points}점</p>
                  </div>
                </div>
                <button
                  onClick={() => handleAssignToAll(chore.id)}
                  disabled={loading || children.length === 0}
                  className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  모든 자녀에게 할당
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <ParentTabNav />
    </div>
  );
}


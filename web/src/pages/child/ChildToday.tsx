import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';

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
  const navigate = useNavigate();

  useEffect(() => {
    const session = localStorage.getItem('child_session');
    if (session) {
      try {
        const parsedSession: ChildSession = JSON.parse(session);
        setChildSession(parsedSession);
        loadAssignments(parsedSession.childId);
      } catch (e) {
        navigate('/child-login');
      }
    } else {
      navigate('/child-login');
    }

    // Subscribe to submission status updates
    const channel = supabase
      .channel('child-submissions-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
        },
        (payload) => {
          if (payload.new.status === 'approved') {
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 3000);
            
            // Update points in session
            const session = localStorage.getItem('child_session');
            if (session) {
              const parsedSession: ChildSession = JSON.parse(session);
              // Reload points from database
              supabase
                .from('children')
                .select('points')
                .eq('id', parsedSession.childId)
                .single()
                .then(({ data }) => {
                  if (data) {
                    const updatedSession = { ...parsedSession, points: data.points };
                    localStorage.setItem('child_session', JSON.stringify(updatedSession));
                    setChildSession(updatedSession);
                  }
                });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [navigate]);

  const loadAssignments = async (childId: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data } = await supabase
        .from('chore_assignments')
        .select(`
          *,
          chore:chores(*)
        `)
        .eq('child_id', childId)
        .eq('due_date', today)
        .eq('status', 'todo')
        .order('created_at', { ascending: false });

      if (data) {
        setAssignments(data as ChoreAssignment[]);
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = (choreId: string) => {
    navigate(`/child/upload?chore_id=${choreId}`);
  };

  if (loading || !childSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 via-orange-50 to-pink-50 pb-20">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-orange-50 to-pink-50 pb-20">
      {/* Confetti effect */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="text-6xl animate-bounce">🎉</div>
        </div>
      )}
      
      <div className="max-w-md mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-3xl shadow-xl p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">
              Hi, {childSession.nickname} 👋
            </h1>
            <div className="bg-green-100 rounded-full px-4 py-2">
              <span className="text-green-700 font-semibold text-sm">
                ⭐ {childSession.points} 포인트
              </span>
            </div>
          </div>
          <p className="text-gray-600 text-sm">오늘 할 일을 완료해보세요!</p>
        </div>

        {/* Today's Chores */}
        {assignments.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <p className="text-gray-500 text-lg">오늘 할 일이 없습니다! 🎉</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="bg-white rounded-2xl shadow-lg p-4 cursor-pointer hover:shadow-xl transition-shadow"
                onClick={() => handleUpload(assignment.chore.id)}
              >
                <div className="text-center">
                  <div className="text-4xl mb-2">🧹</div>
                  <h3 className="font-bold text-gray-800 mb-2 text-sm">
                    {assignment.chore.title}
                  </h3>
                  <div className="flex items-center justify-center gap-1 mb-3">
                    <span className="text-yellow-500">⭐</span>
                    <span className="text-sm font-semibold text-gray-700">
                      {assignment.chore.points}점
                    </span>
                  </div>
                  <button className="w-full px-3 py-2 bg-gradient-to-r from-orange-400 to-pink-400 text-white rounded-lg hover:from-orange-500 hover:to-pink-500 transition-colors text-sm font-medium">
                    📸 업로드
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ChildTabNav />
    </div>
  );
}

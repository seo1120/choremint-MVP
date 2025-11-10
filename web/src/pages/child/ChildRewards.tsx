import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';
import Icon from '../../components/Icon';

interface ChildSession {
  childId: string;
  nickname: string;
  points: number;
  familyId: string;
}

interface PointsLedger {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
}

export default function ChildRewards() {
  const [childSession, setChildSession] = useState<ChildSession | null>(null);
  const [pointsHistory, setPointsHistory] = useState<PointsLedger[]>([]);
  const [loading, setLoading] = useState(true);
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
      // 초기 로드 시 최신 포인트 가져오기
      loadPointsHistory(parsedSession.childId);
    } catch (e) {
      navigate('/');
      return;
    }

    // Subscribe to points_ledger updates (포인트 실시간 갱신)
    // child_points_view는 뷰이므로 직접 구독할 수 없으므로 points_ledger를 구독
    const pointsLedgerChannel = supabase
      .channel('child-rewards-points-updates')
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
          loadPointsHistory(parsedSession.childId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pointsLedgerChannel);
    };
  }, [navigate]);

  const loadPointsHistory = async (childId: string) => {
    try {
      // 포인트 내역과 함께 최신 포인트도 가져오기
      const [historyResult, pointsResult] = await Promise.all([
        supabase
          .from('points_ledger')
          .select('*')
          .eq('child_id', childId)
          .order('created_at', { ascending: false })
          .limit(50),
        // Use child_points_view for real-time accurate points from points_ledger
        supabase
          .from('child_points_view')
          .select('total_points')
          .eq('child_id', childId)
          .single()
      ]);

      if (historyResult.data) {
        setPointsHistory(historyResult.data);
      }

      // 최신 포인트로 세션 업데이트
      if (pointsResult.data) {
        const session = localStorage.getItem('child_session');
        if (session) {
          try {
            const parsedSession: ChildSession = JSON.parse(session);
            const updatedSession = { ...parsedSession, points: pointsResult.data.total_points };
            localStorage.setItem('child_session', JSON.stringify(updatedSession));
            setChildSession(updatedSession);
          } catch (e) {
            console.error('Error updating session:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error loading points history:', error);
    } finally {
      setLoading(false);
    }
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
      <div className="max-w-md mx-auto p-4">
        {/* Points Summary */}
        <div className="bg-white rounded-3xl shadow-xl p-6 mb-4">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-2">
              <Icon name="star" size={24} className="md:w-8 md:h-8" />
              {childSession.points} pts
            </h1>
            <p className="text-gray-600">Total Points</p>
          </div>
        </div>

        {/* Points History */}
        <div className="bg-white rounded-3xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Points History</h2>
          {pointsHistory.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No points history yet.</p>
          ) : (
            <div className="space-y-3">
              {pointsHistory.map((entry) => (
                <div key={entry.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-800">
                      {entry.reason === 'chore_approved' ? 'Chore Completed' : entry.reason}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-lg font-bold ${entry.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.delta > 0 ? '+' : ''}{entry.delta} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ChildTabNav />
    </div>
  );
}


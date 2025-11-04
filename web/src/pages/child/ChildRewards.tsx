import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';

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
    if (session) {
      try {
        const parsedSession: ChildSession = JSON.parse(session);
        setChildSession(parsedSession);
        loadPointsHistory(parsedSession.childId);
      } catch (e) {
        navigate('/child-login');
      }
    } else {
      navigate('/child-login');
    }
  }, [navigate]);

  const loadPointsHistory = async (childId: string) => {
    try {
      const { data } = await supabase
        .from('points_ledger')
        .select('*')
        .eq('child_id', childId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (data) {
        setPointsHistory(data);
      }
    } catch (error) {
      console.error('Error loading points history:', error);
    } finally {
      setLoading(false);
    }
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
      <div className="max-w-md mx-auto p-4">
        {/* Points Summary */}
        <div className="bg-white rounded-3xl shadow-xl p-6 mb-4">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              ⭐ {childSession.points}점
            </h1>
            <p className="text-gray-600">보유 포인트</p>
          </div>
        </div>

        {/* Points History */}
        <div className="bg-white rounded-3xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">포인트 내역</h2>
          {pointsHistory.length === 0 ? (
            <p className="text-gray-500 text-center py-8">포인트 내역이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {pointsHistory.map((entry) => (
                <div key={entry.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-800">
                      {entry.reason === 'chore_approved' ? '집안일 완료' : entry.reason}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-lg font-bold ${entry.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.delta > 0 ? '+' : ''}{entry.delta}점
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


import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ChildLogin() {
  const [familyCode, setFamilyCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Check if child is already logged in
    const childSession = localStorage.getItem('child_session');
    if (childSession) {
      try {
        const session = JSON.parse(childSession);
        if (session.childId && session.nickname && session.familyId) {
          navigate('/child/today');
        }
      } catch (e) {
        localStorage.removeItem('child_session');
      }
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!familyCode.trim() || !pin.trim()) {
      setError('가족 코드와 PIN을 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      // Find family by family code
      const { data: familyData, error: familyError } = await supabase
        .from('families')
        .select('id')
        .eq('family_code', familyCode.trim().toUpperCase())
        .single();

      if (familyError) {
        console.error('Family error:', familyError);
        throw new Error('가족 코드가 올바르지 않습니다.');
      }

      if (!familyData) {
        throw new Error('가족 코드가 올바르지 않습니다.');
      }

      // Find child by PIN within the family
      const { data: childData, error: childError } = await supabase
        .from('children')
        .select('id, nickname, pin, points, family_id')
        .eq('family_id', familyData.id)
        .eq('pin', pin.trim())
        .single();

      if (childError) {
        console.error('Child error:', childError);
        throw new Error('PIN이 올바르지 않거나 이 가족에 속하지 않습니다.');
      }

      if (!childData) {
        throw new Error('PIN이 올바르지 않거나 이 가족에 속하지 않습니다.');
      }

      // Save child session
      const childSession = {
        childId: childData.id,
        nickname: childData.nickname,
        pin: childData.pin,
        points: childData.points,
        familyId: childData.family_id,
        loggedInAt: Date.now(),
      };

             localStorage.setItem('child_session', JSON.stringify(childSession));
             
             // Navigate to child dashboard
             navigate('/child/today');
    } catch (err: any) {
      setError(err.message || '로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-orange-50 to-pink-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">자녀 로그인</h1>
          <p className="text-gray-600">가족 코드와 PIN을 입력해주세요</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              🏠 가족 코드
            </label>
            <input
              type="text"
              value={familyCode}
              onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
              placeholder="가족 코드를 입력하세요"
              className="w-full px-4 py-3 border-2 border-yellow-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 text-center text-lg font-semibold uppercase"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              🔐 PIN
            </label>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN을 입력하세요"
              className="w-full px-4 py-3 border-2 border-yellow-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 text-center text-lg font-semibold"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700 font-medium">⚠️ {error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !familyCode.trim() || !pin.trim()}
            className="w-full px-6 py-4 bg-gradient-to-r from-orange-400 to-pink-400 text-white rounded-xl hover:from-orange-500 hover:to-pink-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <button
          onClick={() => navigate('/')}
          className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700"
        >
          ← 뒤로 가기
        </button>
      </div>
    </div>
  );
}


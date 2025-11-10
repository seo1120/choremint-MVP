import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';
import Icon from '../../components/Icon';
import { initializePushNotifications } from '../../lib/pushNotifications';

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
  const [level, setLevel] = useState(1);
  const [exp, setExp] = useState(0);
  const [nextLevelExp, setNextLevelExp] = useState(100);
  const [characterMood, setCharacterMood] = useState<'happy' | 'normal' | 'sleepy'>('happy');
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

    // Subscribe to children table updates (포인트 실시간 갱신)
    const childrenChannel = supabase
      .channel('child-points-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'children',
          filter: `id=eq.${parsedSession.childId}`,
        },
        (payload) => {
          console.log('Child points updated:', payload);
          // 포인트가 업데이트되면 세션과 상태 업데이트
          if (payload.new.points !== undefined) {
            const updatedSession = { ...parsedSession, points: payload.new.points };
            localStorage.setItem('child_session', JSON.stringify(updatedSession));
            setChildSession(updatedSession);
            calculateLevel(payload.new.points);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(submissionsChannel);
      supabase.removeChannel(childrenChannel);
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

  const loadLatestPoints = async (childId: string) => {
    try {
      const { data } = await supabase
        .from('children')
        .select('points')
        .eq('id', childId)
        .single();

      if (data) {
        const session = localStorage.getItem('child_session');
        if (session) {
          try {
            const parsedSession: ChildSession = JSON.parse(session);
            const updatedSession = { ...parsedSession, points: data.points };
            localStorage.setItem('child_session', JSON.stringify(updatedSession));
            setChildSession(updatedSession);
            calculateLevel(data.points);
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
        className="max-w-md mx-auto px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)',
          paddingBottom: '16px',
        }}
      >
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-800">
              Hi, {childSession.nickname} 👋
            </h1>
            <div className="bg-green-100 rounded-full px-4 py-2 flex items-center gap-1">
              <Icon name="star" size={14} className="md:w-4 md:h-4" />
              <span className="text-green-700 font-semibold text-sm">
                {childSession.points} points
              </span>
            </div>
          </div>
          <p className="text-gray-600 text-sm">Complete today's chores!</p>
        </div>

        {/* Character Section */}
        <div className="bg-gradient-to-br from-[#E6F9F5] to-[#D0F4ED] rounded-3xl shadow-xl p-6 mb-4">
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
                    <Icon name="star" size={16} className="text-yellow-500" />
                    <span className="text-sm font-semibold text-gray-700">
                      {assignment.chore.points} pts
                    </span>
                  </div>
                  <button className="w-full px-3 py-2 bg-gradient-to-r from-orange-400 to-pink-400 text-white rounded-lg hover:from-orange-500 hover:to-pink-500 transition-colors text-sm font-medium">
                    📸 Upload
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

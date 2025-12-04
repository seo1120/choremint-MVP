import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';

interface CharacterSlot {
  slot_number: number;
  level: number;
  position_top: string;
  position_left: string;
  background_image: string;
  stage_number: number;
  mission_name: string;
  level_achieved_at: string | null; // 이 레벨에 도달한 날짜
}

interface ProgressTracker {
  current_goal_number: number;
}

interface ChildSession {
  childId: string;
  nickname: string;
  points: number;
  familyId: string;
}

interface GoalHistory {
  reward: string | null;
  achieved_at: string;
}

// 기본 슬롯 설정 (DB에서 못 가져올 경우 사용)
const DEFAULT_SLOT_CONFIG = [
  { slot_number: 1, position_top: '71%', position_left: '12%', background_image: '/icons/characters/background-1.png', stage_number: 1 },
  { slot_number: 2, position_top: '49%', position_left: '74%', background_image: '/icons/characters/background-1.png', stage_number: 1 },
  { slot_number: 3, position_top: '33%', position_left: '38%', background_image: '/icons/characters/background-1.png', stage_number: 1 },
];

// 기본 미션 이름 (부모가 설정하지 않은 경우)
const DEFAULT_MISSION_NAMES: Record<number, string> = {
  1: 'Mission 1',
  2: 'Mission 2',
  3: 'Mission 3',
};

export default function ChildCharacter() {
  const [slots, setSlots] = useState<CharacterSlot[]>([]);
  const [progressTracker, setProgressTracker] = useState<ProgressTracker>({ current_goal_number: 1 });
  const [loading, setLoading] = useState(true);
  const [childSession, setChildSession] = useState<ChildSession | null>(null);
  const [currentStage, setCurrentStage] = useState(1);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterSlot | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      loadCharacterData(parsedSession.childId);
    } catch (e) {
      navigate('/');
      return;
    }

    // 실시간 업데이트 구독 - character_slots 테이블
    const slotsChannel = supabase
      .channel('character-slots-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'character_slots',
          filter: `child_id=eq.${parsedSession.childId}`,
        },
        () => {
          console.log('Character slots updated');
          loadCharacterData(parsedSession.childId);
        }
      )
      .subscribe();

    // progress_tracker 구독
    const trackerChannel = supabase
      .channel('progress-tracker-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'character_progress_tracker',
          filter: `child_id=eq.${parsedSession.childId}`,
        },
        () => {
          console.log('Progress tracker updated');
          loadCharacterData(parsedSession.childId);
        }
      )
      .subscribe();

    // points_ledger 변경도 구독 (캐릭터 진화 트리거)
    const pointsChannel = supabase
      .channel('character-points-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'points_ledger',
          filter: `child_id=eq.${parsedSession.childId}`,
        },
        () => {
          loadCharacterData(parsedSession.childId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(slotsChannel);
      supabase.removeChannel(trackerChannel);
      supabase.removeChannel(pointsChannel);
    };
  }, [navigate]);

  const loadCharacterData = async (childId: string) => {
    try {
      // 1. 슬롯 설정 로드
      const { data: configData } = await supabase
        .from('character_slot_config')
        .select('*')
        .order('slot_number');

      // 2. 자녀의 캐릭터 슬롯 데이터 로드 (updated_at 포함)
      const { data: slotsData } = await supabase
        .from('character_slots')
        .select('slot_number, level, updated_at')
        .eq('child_id', childId)
        .order('slot_number');

      // 3. 진행 상태 로드
      const { data: trackerData } = await supabase
        .from('character_progress_tracker')
        .select('current_goal_number')
        .eq('child_id', childId)
        .single();

      // 4. 완료된 목표 히스토리 로드 (미션 이름용)
      const { data: goalHistoryData } = await supabase
        .from('goal_history')
        .select('reward, achieved_at')
        .eq('child_id', childId)
        .order('achieved_at', { ascending: true });

      // 5. 현재 목표의 reward 로드 (자녀 테이블에서)
      const { data: childData } = await supabase
        .from('children')
        .select('reward')
        .eq('id', childId)
        .single();

      // 설정 데이터 (DB에서 가져오거나 기본값 사용)
      const config = configData && configData.length > 0 ? configData : DEFAULT_SLOT_CONFIG;

      // 완료된 목표의 미션 이름 매핑
      const completedMissionNames: Record<number, string> = {};
      const completedDates: Record<number, string> = {};
      if (goalHistoryData) {
        goalHistoryData.forEach((goal: GoalHistory, index: number) => {
          const slotNumber = index + 1;
          completedMissionNames[slotNumber] = goal.reward || DEFAULT_MISSION_NAMES[slotNumber] || `Mission ${slotNumber}`;
          completedDates[slotNumber] = goal.achieved_at;
        });
      }

      // 현재 진행 중인 목표 번호
      const currentGoalNumber = trackerData?.current_goal_number || 1;

      // 슬롯 데이터 병합
      const mergedSlots: CharacterSlot[] = config.map((cfg: any) => {
        const slotData = slotsData?.find((s: any) => s.slot_number === cfg.slot_number);
        
        // 미션 이름 결정
        let missionName: string;
        if (completedMissionNames[cfg.slot_number]) {
          missionName = completedMissionNames[cfg.slot_number];
        } else if (cfg.slot_number === currentGoalNumber && childData?.reward) {
          missionName = childData.reward;
        } else {
          missionName = DEFAULT_MISSION_NAMES[cfg.slot_number] || `Mission ${cfg.slot_number}`;
        }

        // 레벨 도달 날짜 결정
        let levelAchievedAt: string | null = null;
        if (completedDates[cfg.slot_number]) {
          // 완료된 목표는 goal_history의 achieved_at 사용
          levelAchievedAt = completedDates[cfg.slot_number];
        } else if (slotData?.updated_at) {
          // 진행 중인 목표는 character_slots의 updated_at 사용
          levelAchievedAt = slotData.updated_at;
        }

        return {
          slot_number: cfg.slot_number,
          level: slotData?.level || cfg.level || 1,
          position_top: cfg.position_top,
          position_left: cfg.position_left,
          background_image: cfg.background_image,
          stage_number: cfg.stage_number,
          mission_name: missionName,
          level_achieved_at: levelAchievedAt,
        };
      });

      setSlots(mergedSlots);
      
      if (trackerData) {
        setProgressTracker(trackerData);
        const currentSlotConfig = config.find((c: any) => c.slot_number === trackerData.current_goal_number);
        if (currentSlotConfig) {
          setCurrentStage(currentSlotConfig.stage_number);
        }
      }
    } catch (error) {
      console.error('Error loading character data:', error);
      setSlots(DEFAULT_SLOT_CONFIG.map(cfg => ({
        ...cfg,
        level: 1,
        mission_name: DEFAULT_MISSION_NAMES[cfg.slot_number] || `Mission ${cfg.slot_number}`,
        level_achieved_at: null,
      })));
    } finally {
      setLoading(false);
    }
  };

  // 캐릭터 이미지 경로 생성
  const getCharacterImage = (slotNumber: number, level: number) => {
    return `/icons/characters/${slotNumber}-${level}.png`;
  };

  // 캐릭터 클릭 핸들러
  const handleCharacterClick = (slot: CharacterSlot) => {
    setSelectedCharacter(slot);
  };

  // 팝업 닫기
  const closePopup = () => {
    setSelectedCharacter(null);
  };

  // 날짜 포맷팅
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'In Progress';
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 이미지 생성 및 다운로드
  const handleDownload = async () => {
    if (!selectedCharacter || !childSession) return;

    setIsGeneratingImage(true);

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 캔버스 크기 설정 (카드 형태)
      const width = 600;
      const height = 800;
      canvas.width = width;
      canvas.height = height;

      // 배경 그라데이션
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#E8F5E9');
      gradient.addColorStop(0.5, '#C8E6C9');
      gradient.addColorStop(1, '#A5D6A7');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // 카드 배경 (둥근 사각형)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.roundRect(30, 30, width - 60, height - 60, 30);
      ctx.fill();

      // 그림자 효과
      ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 10;

      // 캐릭터 이미지 로드
      const characterImg = new Image();
      characterImg.crossOrigin = 'anonymous';
      
      await new Promise<void>((resolve, reject) => {
        characterImg.onload = () => resolve();
        characterImg.onerror = reject;
        characterImg.src = getCharacterImage(selectedCharacter.slot_number, selectedCharacter.level);
      });

      // 캐릭터 이미지 그리기 (중앙 상단)
      ctx.shadowColor = 'transparent';
      const imgSize = 280;
      const imgX = (width - imgSize) / 2;
      const imgY = 80;
      ctx.drawImage(characterImg, imgX, imgY, imgSize, imgSize);

      // 앱 로고/타이틀 (아이콘 + 텍스트)
      const logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      
      await new Promise<void>((resolve) => {
        logoImg.onload = () => resolve();
        logoImg.onerror = () => resolve(); // 로고 로드 실패해도 계속 진행
        logoImg.src = '/choremint_app_icon.png';
      });

      const logoSize = 28;
      const logoTextGap = 8;
      const titleText = 'ChoreMint';
      ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
      const textWidth = ctx.measureText(titleText).width;
      const totalWidth = logoSize + logoTextGap + textWidth;
      const startX = (width - totalWidth) / 2;

      // 로고 이미지 그리기
      if (logoImg.complete && logoImg.naturalWidth > 0) {
        ctx.drawImage(logoImg, startX, 420 - logoSize + 4, logoSize, logoSize);
      }

      // 텍스트 그리기
      ctx.fillStyle = '#4CAF50';
      ctx.textAlign = 'left';
      ctx.fillText(titleText, startX + logoSize + logoTextGap, 420);

      // 미션 이름
      ctx.fillStyle = '#2E7D32';
      ctx.font = 'bold 32px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      const missionText = `🎯 ${selectedCharacter.mission_name}`;
      ctx.fillText(missionText, width / 2, 480);

      // 레벨 표시
      ctx.fillStyle = '#1B5E20';
      ctx.font = 'bold 48px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`Level ${selectedCharacter.level}/5`, width / 2, 550);

      // 레벨 5 달성 시 특별 표시
      if (selectedCharacter.level === 5) {
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
        ctx.fillText('⭐ Max Evolution! ⭐', width / 2, 600);
      }

      // 구분선
      ctx.strokeStyle = '#C8E6C9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(80, 640);
      ctx.lineTo(width - 80, 640);
      ctx.stroke();

      // 날짜/시간
      ctx.fillStyle = '#666666';
      ctx.font = '20px "Segoe UI", Arial, sans-serif';
      ctx.fillText('Achieved on', width / 2, 680);
      
      ctx.fillStyle = '#333333';
      ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
      ctx.fillText(formatDate(selectedCharacter.level_achieved_at), width / 2, 715);

      // 사용자 이름
      ctx.fillStyle = '#888888';
      ctx.font = '18px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`by ${childSession.nickname}`, width / 2, 755);

      // 이미지 다운로드
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `ChoreMint_${selectedCharacter.mission_name.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_Level${selectedCharacter.level}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      }, 'image/png');

    } catch (error) {
      console.error('Image generation failed:', error);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 현재 스테이지의 슬롯만 필터링
  const currentStageSlots = slots.filter(slot => slot.stage_number === currentStage);

  // 현재 스테이지의 배경 이미지
  const currentBackground = currentStageSlots.length > 0 
    ? currentStageSlots[0].background_image 
    : '/icons/characters/background-1.png';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#8BC34A]">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#8BC34A]">
      {/* Hidden canvas for image generation */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Fixed aspect ratio container for background and characters */}
      <div className="absolute inset-0 flex items-center justify-center pb-16">
        <div 
          className="relative"
          style={{ 
            height: 'calc(100vh - 4rem)',
            width: 'calc((100vh - 4rem) * 0.667)',
            maxWidth: '100vw',
            maxHeight: 'calc(100vw * 1.5)',
          }}
        >
          {/* Background image */}
          <img
            src={currentBackground}
            alt="Background"
            className="absolute inset-0 w-full h-full object-fill"
          />
          
          {/* Characters */}
          {currentStageSlots.map((slot) => (
            <div
              key={slot.slot_number}
              onClick={() => handleCharacterClick(slot)}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-500 hover:scale-110 cursor-pointer"
              style={{
                top: slot.position_top,
                left: slot.position_left,
                width: '33%',
              }}
            >
              <div className="relative w-full">
                {/* Character shadow */}
                <div 
                  className="absolute -bottom-[8%] left-1/2 transform -translate-x-1/2 w-[80%] h-[12%] bg-black/20 rounded-full blur-sm"
                />
                {/* Character image */}
                <img
                  src={getCharacterImage(slot.slot_number, slot.level)}
                  alt={`Character ${slot.slot_number} - Level ${slot.level}`}
                  className="w-full h-auto object-contain drop-shadow-lg transition-all duration-300"
                />
                {/* Level 5 indicator */}
                {slot.level === 5 && (
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    <span className="text-[10px]">⭐</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Progress Info Overlay */}
          <div className="absolute top-4 left-4 right-4 bg-white/90 backdrop-blur-sm rounded-2xl p-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-800">
                  {childSession?.nickname}'s Characters
                </h2>
                <p className="text-xs text-gray-600">
                  Goal #{progressTracker.current_goal_number}
                  {progressTracker.current_goal_number > slots.length && ' (Max reached!)'}
                </p>
              </div>
              <div className="flex gap-1">
                {currentStageSlots.map((slot) => (
                  <div 
                    key={slot.slot_number}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      slot.level === 5 
                        ? 'bg-yellow-400 text-yellow-900' 
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {slot.level}/5
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Character Popup Modal */}
      {selectedCharacter && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={closePopup}
        >
          {/* Dark overlay background */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          
          {/* Popup content */}
          <div 
            className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 transform transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button (X) */}
            <button
              onClick={closePopup}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 hover:text-gray-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {/* Mission name */}
            <h3 className="text-xl font-bold text-gray-800 text-center mb-4 pr-8">
              🎯 {selectedCharacter.mission_name}
            </h3>

            {/* Character image */}
            <div className="flex justify-center mb-4">
              <div className="relative">
                <img
                  src={getCharacterImage(selectedCharacter.slot_number, selectedCharacter.level)}
                  alt={`Character ${selectedCharacter.slot_number}`}
                  className="w-48 h-48 object-contain drop-shadow-xl"
                />
                {/* Level badge */}
                <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-[#5CE1C6] to-[#4ECDC4] text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">
                  Level {selectedCharacter.level}/5
                </div>
              </div>
            </div>

            {/* Level 5 special message */}
            {selectedCharacter.level === 5 && (
              <p className="text-center text-yellow-600 font-semibold mb-2">
                ⭐ Max Evolution Achieved! ⭐
              </p>
            )}

            {/* Achievement date */}
            <p className="text-center text-gray-500 text-sm mb-4">
              📅 {formatDate(selectedCharacter.level_achieved_at)}
            </p>

            {/* Download button */}
            <button
              onClick={handleDownload}
              disabled={isGeneratingImage}
              className="w-full py-3 bg-gradient-to-r from-[#5CE1C6] to-[#4ECDC4] text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingImage ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Download Card
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Bottom navigation */}
      <ChildTabNav />
    </div>
  );
}

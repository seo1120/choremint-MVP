import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ChildTabNav from '../../components/ChildTabNav';

interface ChildSession {
  childId: string;
  nickname: string;
  points: number;
  familyId: string;
}

interface Chore {
  id: string;
  title: string;
  points: number;
}

export default function ChildUpload() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [childSession, setChildSession] = useState<ChildSession | null>(null);
  const [chore, setChore] = useState<Chore | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const session = localStorage.getItem('child_session');
    if (session) {
      try {
        const parsedSession: ChildSession = JSON.parse(session);
        setChildSession(parsedSession);
        
        // Load chore if chore_id is provided
        const choreId = searchParams.get('chore_id');
        if (choreId) {
          loadChore(choreId);
        }
      } catch (e) {
        navigate('/child-login');
      }
    } else {
      navigate('/child-login');
    }
  }, [searchParams, navigate]);

  const loadChore = async (choreId: string) => {
    try {
      const { data } = await supabase
        .from('chores')
        .select('*')
        .eq('id', choreId)
        .single();

      if (data) {
        setChore(data);
      }
    } catch (error) {
      console.error('Error loading chore:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!childSession || !selectedFile) {
      setError('사진을 선택해주세요.');
      return;
    }

    setLoading(true);
    try {
      // Upload photo to Supabase Storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${childSession.childId}-${Date.now()}.${fileExt}`;
      const filePath = `submissions/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('photos')
        .getPublicUrl(filePath);

      // Create submission
      const { error: submissionError } = await supabase
        .from('submissions')
        .insert({
          child_id: childSession.childId,
          family_id: childSession.familyId,
          chore_id: chore?.id || null,
          photo_url: urlData.publicUrl,
          status: 'pending',
        });

      if (submissionError) throw submissionError;

      // Update assignment status if chore_id exists
      if (chore?.id) {
        const today = new Date().toISOString().split('T')[0];
        await supabase
          .from('chore_assignments')
          .update({ status: 'done' })
          .eq('chore_id', chore.id)
          .eq('child_id', childSession.childId)
          .eq('due_date', today);
      }

      alert('사진이 성공적으로 업로드되었습니다!');
      setSelectedFile(null);
      setPreview('');
      navigate('/child/today');
    } catch (err: any) {
      setError(err.message || '업로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!childSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 via-orange-50 to-pink-50 pb-20">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-orange-50 to-pink-50 pb-20">
      <div className="max-w-md w-full mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-3xl shadow-lg p-6 mb-4">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            {chore ? chore.title : '사진 업로드'}
          </h1>
          {chore && (
            <p className="text-gray-600 text-sm">⭐ {chore.points}점 획득 가능</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Photo Upload Card */}
          <div className="bg-white rounded-2xl p-5 shadow-md border-2 border-green-100">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              📸 사진 선택
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full px-4 py-3 bg-white border-2 border-green-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-green-400 transition-all file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
              required
            />
          </div>

          {/* Preview Card */}
          {preview && (
            <div className="bg-gray-50 rounded-2xl p-4 shadow-md border-2 border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-2">📷 미리보기</p>
              <img
                src={preview}
                alt="Preview"
                className="w-full h-64 object-cover rounded-xl"
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700 font-medium">⚠️ {error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || !selectedFile}
            className="w-full px-6 py-4 bg-gradient-to-r from-orange-400 to-pink-400 text-white rounded-2xl hover:from-orange-500 hover:to-pink-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span> 업로드 중...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                ✅ 완료 사진 올리기
              </span>
            )}
          </button>
        </form>
      </div>
      <ChildTabNav />
    </div>
  );
}


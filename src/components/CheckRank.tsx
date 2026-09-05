import { useEffect, useState, useRef } from 'react';
import { supabase, type Quiz } from '@/lib/supabase';
import { formatDate, formatDuration, formatTimeOfDay } from '@/lib/utils';
import {
  Search,
  Loader2,
  Trophy,
  Medal,
  Award,
  User,
  Phone,
  AlertCircle,
  Brain,
  Clock,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Upload,
  RefreshCw,
} from 'lucide-react';

type Props = {
  onBack: () => void;
};

type StudentResult = {
  submission_id?: string;
  score: number;
  rank: number | null;
  total_participants: number;
  total_questions: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  percentage: number;
  student_name: string;
  school_name: string;
  grade: number | null;
  is_top_10: boolean;
  photo_url: string;
  time_taken_seconds: number | null;
  submitted_at: string;
  error?: string;
};

type UploadToken = {
  ok?: boolean;
  submission_id?: string;
  rank?: number;
  quiz_id?: string;
  error?: string;
};

const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export default function CheckRank({ onBack }: Props) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [studentName, setStudentName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<StudentResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Photo upload state
  const [uploadToken, setUploadToken] = useState<UploadToken | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from('quizzes')
      .select('*')
      .eq('results_published', true)
      .order('start_time', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setQuizzes(data as Quiz[]);
        setLoading(false);
      });
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError(null);
    setResult(null);
    setUploadToken(null);
    setPhotoPreview(null);
    setUploadError(null);
    setUploadSuccess(false);
    if (!selectedQuiz) {
      setSearchError('Please select an exam.');
      return;
    }
    if (!studentName.trim()) {
      setSearchError('Please enter your full name.');
      return;
    }
    if (!whatsappNumber.trim()) {
      setSearchError('Please enter your WhatsApp number.');
      return;
    }
    setSearching(true);
    try {
      const { data, error } = await supabase.rpc('get_student_result', {
        p_quiz_id: selectedQuiz.id,
        p_student_name: studentName.trim(),
        p_whatsapp_number: whatsappNumber.trim(),
      });
      if (error) throw error;
      const r = data as StudentResult;
      if (r.error) {
        setSearchError(r.error);
      } else {
        const totalQuestions = Number(r.total_questions) || 0;
        const correct = Number(r.correct ?? r.score) || 0;
        const answered = Number(r.unanswered) >= 0
          ? totalQuestions - Number(r.unanswered)
          : correct;
        const normalizedResult: StudentResult = {
          ...r,
          rank: r.rank ?? (Number(r.total_participants) === 1 ? 1 : null),
          correct,
          incorrect: Number.isFinite(Number(r.incorrect))
            ? Number(r.incorrect)
            : Math.max(answered - correct, 0),
          unanswered: Math.max(Number(r.unanswered) || 0, 0),
          percentage: Number.isFinite(Number(r.percentage))
            ? Number(r.percentage)
            : (correct / Math.max(totalQuestions, 1)) * 100,
        };
        setResult(normalizedResult);
        // If top 10, get upload token
        if (normalizedResult.is_top_10) {
          if (normalizedResult.submission_id) {
            setUploadToken({
              ok: true,
              submission_id: normalizedResult.submission_id,
              rank: normalizedResult.rank ?? undefined,
              quiz_id: selectedQuiz.id,
            });
            if (normalizedResult.photo_url) setPhotoPreview(normalizedResult.photo_url);
          }
          const { data: tokenData, error: tokenError } = await supabase.rpc(
            'verify_top10_and_get_upload_token',
            {
              p_quiz_id: selectedQuiz.id,
              p_student_name: studentName.trim(),
              p_whatsapp_number: whatsappNumber.trim(),
            }
          );
          if (!tokenError && tokenData) {
            const token = tokenData as UploadToken;
            if (token.ok) {
              setUploadToken(token);
              if (normalizedResult.photo_url) setPhotoPreview(normalizedResult.photo_url);
            }
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : 'Failed to look up result.';
      setSearchError(message);
    } finally {
      setSearching(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploadSuccess(false);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError('Please select a JPG, JPEG, PNG, or WEBP image.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setUploadError('Image is too large. Maximum size is 5MB.');
      return;
    }

    // Preview
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload
    handleUpload(file);
  };

  const handleUpload = async (file: File) => {
    if (!uploadToken || !selectedQuiz) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `${uploadToken.submission_id}/photo.${fileExt}`;

      // Delete existing photo if any
      if (result?.photo_url) {
        const oldPath = result.photo_url.split('/top10-photos/')[1];
        if (oldPath) {
          await supabase.storage.from('top10-photos').remove([oldPath]);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('top10-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('top10-photos')
        .getPublicUrl(filePath);

      const photoUrl = urlData.publicUrl;

      // Update the submission with the photo URL
      const { error: updateError } = await supabase.rpc('update_photo_url', {
        p_quiz_id: selectedQuiz.id,
        p_student_name: studentName.trim(),
        p_whatsapp_number: whatsappNumber.trim(),
        p_photo_url: photoUrl,
      });

      if (updateError) throw updateError;

      setUploadSuccess(true);
      setResult((prev) => prev ? { ...prev, photo_url: photoUrl } : prev);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleReplacePhoto = () => {
    fileInputRef.current?.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 transition">
            ← Home
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 rounded-2xl mb-3">
            <Search className="w-7 h-7 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Check Your Result</h1>
          <p className="text-slate-600 mt-1">Enter your details to see your exam results</p>
        </div>

        {quizzes.length === 0 ? (
          <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
            <Brain className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">Results have not been published yet.</p>
          </div>
        ) : (
          <>
            <form
              onSubmit={handleSearch}
              className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 mb-6"
            >
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Select Exam
                </label>
                <select
                  value={selectedQuiz?.id || ''}
                  onChange={(e) =>
                    setSelectedQuiz(quizzes.find((q) => q.id === e.target.value) || null)
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose an exam...</option>
                  {quizzes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title} — {formatDate(q.start_time)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-11 pr-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter the full name you used"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  WhatsApp / Mobile Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-11 pr-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Same number you entered during the exam"
                  />
                </div>
              </div>

              {searchError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  {searchError}
                </div>
              )}

              <button
                type="submit"
                disabled={searching}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
              >
                {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                {searching ? 'Searching...' : 'Check My Result'}
              </button>
            </form>

            {/* Result card */}
            {result && (
              <div className="space-y-4">
                {/* Result header */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  {/* Title banner */}
                  <div className="bg-gradient-to-br from-slate-700 to-slate-900 px-5 py-4 text-center sm:px-6 sm:py-5">
                    <h2 className="text-lg sm:text-xl font-bold text-white leading-snug">
                      ඉතිහාසය තක්සලාව - උදය සර්
                    </h2>
                    <p className="text-sm text-lime-300 mt-1 font-semibold tracking-wide">
                      History AM Class
                    </p>
                  </div>

                    {/* Island rank */}
                  <div
                    className={`p-5 text-center sm:p-6 ${
                      result.rank === 1
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                        : result.rank === 2
                        ? 'bg-gradient-to-br from-slate-400 to-slate-600'
                        : result.rank === 3
                        ? 'bg-gradient-to-br from-orange-400 to-orange-600'
                        : result.is_top_10
                        ? 'bg-gradient-to-br from-blue-500 to-blue-700'
                        : 'bg-gradient-to-br from-slate-700 to-slate-900'
                    }`}
                  >
                    {result.rank !== null && result.rank <= 3 && (
                      <div className="mb-2">
                        {result.rank === 1 && <Trophy className="w-10 h-10 sm:w-12 sm:h-12 text-white mx-auto" />}
                        {result.rank === 2 && <Medal className="w-10 h-10 sm:w-12 sm:h-12 text-white mx-auto" />}
                        {result.rank === 3 && <Award className="w-10 h-10 sm:w-12 sm:h-12 text-white mx-auto" />}
                      </div>
                    )}
                    <p className="text-4xl sm:text-5xl font-bold text-white tabular-nums">
                      {result.rank ? `#${result.rank}` : 'Pending'}
                    </p>
                    <p className="text-white/90 text-sm sm:text-base font-semibold mt-1.5">
                      Island Rank / දිවයිනේ කුසලතාවය
                    </p>
                    <p className="text-white/70 text-xs sm:text-sm mt-0.5">
                      out of {result.total_participants} participants
                    </p>
                    {result.is_top_10 && (
                      <span className="inline-block mt-3 bg-white/20 text-white text-xs font-medium px-3 py-1 rounded-full">
                        Top 10 Achiever!
                      </span>
                    )}
                  </div>

                  {/* Student info */}
                  <div className="p-6 space-y-4">
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-sm text-slate-500 mb-1">Student Name</p>
                      <p className="font-semibold text-slate-900 text-lg">{result.student_name}</p>
                      <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
                        <span>School: {result.school_name || '-'}</span>
                        <span>Grade: {result.grade ?? '-'}</span>
                      </div>
                    </div>

                    {/* Score + Percentage */}
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-sm text-slate-500 mb-1">නිවැරදි ප්‍රශ්න</p>
                        <p className="text-2xl font-bold text-slate-900">
                          {result.correct}
                          <span className="text-slate-400 text-lg">/{result.total_questions}</span>
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-sm text-slate-500 mb-1">Percentage</p>
                        <p className="text-2xl font-bold text-slate-900">{result.percentage}%</p>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
                        <p className="text-xl font-bold text-green-700">{result.correct}</p>
                        <p className="text-xs text-green-600">Correct</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-3 text-center">
                        <XCircle className="w-5 h-5 text-red-600 mx-auto mb-1" />
                        <p className="text-xl font-bold text-red-700">{result.incorrect}</p>
                        <p className="text-xs text-red-600">Incorrect</p>
                      </div>
                      <div className="bg-slate-100 rounded-xl p-3 text-center">
                        <MinusCircle className="w-5 h-5 text-slate-500 mx-auto mb-1" />
                        <p className="text-xl font-bold text-slate-700">{result.unanswered}</p>
                        <p className="text-xs text-slate-500">Unanswered</p>
                      </div>
                    </div>

                    {/* Time taken */}
                    <div className="bg-slate-50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm text-slate-500 mb-1">Time Taken</p>
                        <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <Clock className="w-5 h-5 text-slate-400" />
                          {formatDuration(result.time_taken_seconds)}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-sm text-slate-500 mb-1">Submitted At</p>
                        <p className="text-sm font-medium text-slate-700">
                          {formatTimeOfDay(result.submitted_at)}
                        </p>
                      </div>
                    </div>

                    {/* Congratulations message */}
                    <div className="congrats-banner rounded-xl p-5 text-center bg-gradient-to-br from-green-50 to-lime-50 border border-green-200">
                      <p className="text-2xl mb-1">🎉</p>
                      <p className="font-bold text-green-700 text-lg">සුභ පැතුම්!</p>
                      <p className="text-sm text-green-600 mt-1">
                        ඔබගේ විශිෂ්ට ප්‍රතිඵලයට උණුසුම් සුභ පැතුම්!
                      </p>
                    </div>
                  </div>
                </div>

                {/* Top 10 Photo Upload */}
                {result.is_top_10 && (
                  <div className="bg-white border border-amber-200 rounded-2xl p-6">
                    <div className="text-center mb-4">
                      <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-100 rounded-2xl mb-3">
                        <Trophy className="w-7 h-7 text-amber-600" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">Top 10 Achiever</h3>
                      <p className="text-slate-600 text-sm mt-1">
                        Congratulations! You are in the Top 10. Upload your photo for the celebration poster.
                      </p>
                    </div>

                    {/* Photo preview */}
                    {photoPreview && (
                      <div className="mb-4 flex justify-center">
                        <div className="relative">
                          <img
                            src={photoPreview}
                            alt="Your photo"
                            className="w-32 h-32 rounded-2xl object-cover border-2 border-amber-300"
                          />
                        </div>
                      </div>
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {uploadError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm flex items-start gap-2 mb-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        {uploadError}
                      </div>
                    )}

                    {uploadSuccess && (
                      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                        Photo uploaded successfully!
                      </div>
                    )}

                    <div className="flex gap-3">
                      {!result.photo_url && !photoPreview ? (
                        <button
                          onClick={handleReplacePhoto}
                          disabled={uploading}
                          className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition"
                        >
                          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                          {uploading ? 'Uploading...' : 'Upload Your Photo'}
                        </button>
                      ) : (
                        <button
                          onClick={handleReplacePhoto}
                          disabled={uploading}
                          className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold py-3 rounded-xl transition"
                        >
                          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                          {uploading ? 'Uploading...' : 'Replace Photo'}
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 mt-3 text-center">
                      JPG, JPEG, PNG, or WEBP. Maximum 5MB.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

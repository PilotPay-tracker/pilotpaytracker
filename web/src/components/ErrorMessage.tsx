import { AlertCircle, RefreshCw } from 'lucide-react';

export function ErrorMessage({
  message = 'Something went wrong loading this data.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <AlertCircle size={20} className="text-red-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-300">Failed to load</p>
        <p className="text-xs text-slate-500 mt-0.5 max-w-[280px]">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] text-slate-400 hover:text-white text-sm transition-colors"
        >
          <RefreshCw size={13} />
          Try again
        </button>
      )}
    </div>
  );
}

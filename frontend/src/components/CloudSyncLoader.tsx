import { Loader2 } from 'lucide-react';

export default function CloudSyncLoader({ message, percent }: { message: string; percent: number }) {
  const progress = Math.max(3, Math.min(100, percent || 3));
  return (
    <div className="flex min-h-[45dvh] items-center justify-center px-4">
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-32 w-40 items-center justify-center">
          <div className="relative h-28 w-36">
            <div className="absolute left-1 top-4 h-16 w-24 rounded-full bg-blue-100 shadow-inner" />
            <div className="absolute left-7 top-0 h-20 w-20 rounded-full bg-blue-100 shadow-inner" />
            <div className="absolute left-16 top-7 h-14 w-16 rounded-full bg-blue-100 shadow-inner" />
            <div className="absolute left-6 top-12 h-8 w-24 overflow-hidden rounded-full border border-blue-200 bg-white">
              <div className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
            </div>
            <div className="absolute right-0 bottom-0 h-20 w-12 rounded-lg border border-slate-300 bg-white shadow-md">
              <div className="mx-auto mt-3 h-2 w-7 rounded bg-slate-200" />
              <div className="mx-auto mt-2 h-2 w-7 rounded bg-blue-400 animate-pulse" />
              <div className="mx-auto mt-2 h-2 w-7 rounded bg-slate-200" />
              <div className="mx-auto mt-2 h-2 w-7 rounded bg-blue-300 animate-pulse" />
            </div>
            <Loader2 className="absolute left-14 top-16 h-7 w-7 animate-spin text-blue-600" />
          </div>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Downloading workflows from cloud</h2>
        <p className="mt-2 text-sm text-gray-500">{message}</p>
        <p className="mt-2 text-sm font-bold text-blue-600">{progress}%</p>
        <div className="mx-auto mt-5 h-2 w-72 overflow-hidden rounded-full bg-blue-100">
          <div className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}

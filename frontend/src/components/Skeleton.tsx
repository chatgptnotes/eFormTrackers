import { memo } from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton = memo(function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`bg-gray-200 animate-pulse rounded ${className}`} />;
});

export const SkeletonStatCard = memo(function SkeletonStatCard() {
  return (
    <div className="rounded-2xl p-6 border-2 border-gray-200 bg-white shadow-md">
      <div className="flex items-start justify-between mb-4">
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-3 w-28 mb-3" />
      <Skeleton className="h-10 w-20" />
    </div>
  );
});

export const SkeletonSubmissionCard = memo(function SkeletonSubmissionCard() {
  return (
    <div className="rounded-2xl p-6 border-2 border-gray-200 bg-white shadow-md space-y-3">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-16 rounded-lg" />
        </div>
      </div>
      <div className="flex items-center gap-2 py-2 border-t border-gray-100">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="flex items-center gap-2 py-2 border-t border-gray-100 bg-blue-50 px-3 rounded-lg">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-100">
        <div className="space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-20" /></div>
        <div className="space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-20" /></div>
      </div>
      <div className="pt-2 border-t border-gray-100">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
});

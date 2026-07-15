"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800",
        className,
      )}
    />
  );
}

export function VenueCardSkeleton() {
  return (
    <div className="border-2 border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-lg my-2">
      {/* Venue photo placeholder */}
      <Skeleton className="w-full h-44 rounded-none" />

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon placeholder */}
          <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />

          <div className="flex-1 min-w-0">
            {/* Title and score */}
            <div className="flex items-center gap-2 mb-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-12" />
            </div>

            {/* Address */}
            <Skeleton className="h-3 w-48 mb-3" />

            {/* Amenity badges */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Skeleton className="h-5 w-14 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-12 rounded-md" />
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Skeleton className="h-9 rounded-xl w-full" />
                <Skeleton className="h-9 rounded-xl w-full" />
              </div>
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5">
                <Skeleton className="h-8 rounded-lg flex-1 sm:w-20" />
                <Skeleton className="h-8 rounded-lg flex-1 sm:w-20" />
                <Skeleton className="h-8 rounded-lg flex-1 sm:w-20" />
                <Skeleton className="h-8 rounded-lg flex-1 sm:w-20" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VenueListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-24 mb-2" />
      {Array.from({ length: count }).map((_, i) => (
        <VenueCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg px-4 py-3 bg-zinc-100 dark:bg-zinc-900">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    </div>
  );
}

export function AgentStepsSkeleton() {
  return (
    <div className="ml-2 space-y-2 border-l-2 border-zinc-200 dark:border-zinc-800 pl-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Skeleton className="w-3 h-3 rounded" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export function MapMarkerSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 rounded-lg">
      <div className="text-center">
        <Skeleton className="w-12 h-12 rounded-full mx-auto mb-2" />
        <Skeleton className="h-3 w-24 mx-auto" />
      </div>
    </div>
  );
}

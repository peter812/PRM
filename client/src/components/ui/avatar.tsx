"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(`
      after:content-[''] after:block after:absolute after:inset-0 after:rounded-full after:pointer-events-none after:border after:border-black/10 dark:after:border-white/10
      relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full`,
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

export interface AvatarImageProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> {
  fallbackSrc?: string;
}

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  AvatarImageProps
>(({ className, src, fallbackSrc, onError, onLoadingStatusChange, ...props }, ref) => {
  const [imgSrc, setImgSrc] = React.useState(src);

  React.useEffect(() => {
    setImgSrc(src);
  }, [src]);

  const handleLoadingStatusChange = React.useCallback(
    (status: "idle" | "loading" | "loaded" | "error") => {
      if (status === "error" && fallbackSrc && imgSrc !== fallbackSrc) {
        setImgSrc(fallbackSrc);
        return;
      }
      onLoadingStatusChange?.(status);
    },
    [fallbackSrc, imgSrc, onLoadingStatusChange]
  );

  return (
    <AvatarPrimitive.Image
      ref={ref}
      src={imgSrc}
      className={cn("aspect-square h-full w-full", className)}
      onLoadingStatusChange={handleLoadingStatusChange}
      onError={onError}
      {...props}
    />
  );
})
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }

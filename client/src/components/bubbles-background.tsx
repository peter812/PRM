import { useEffect, useState } from "react";

export function BubblesBackground() {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const checkAero = () => {
      setIsActive(document.documentElement.classList.contains("aero"));
    };

    // Initial check on mount
    checkAero();

    // Listen to local theme changes and system preferences changes
    window.addEventListener("theme-change", checkAero);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", checkAero);

    return () => {
      window.removeEventListener("theme-change", checkAero);
      mql.removeEventListener("change", checkAero);
    };
  }, []);

  if (!isActive) return null;

  // Static preset bubble configs to prevent hydration mismatches
  const bubbles = [
    { left: "5%", size: "40px", delay: "0s", duration: "12s" },
    { left: "15%", size: "60px", delay: "2s", duration: "15s" },
    { left: "25%", size: "30px", delay: "4s", duration: "10s" },
    { left: "35%", size: "50px", delay: "1s", duration: "14s" },
    { left: "45%", size: "75px", delay: "5s", duration: "18s" },
    { left: "55%", size: "35px", delay: "3s", duration: "11s" },
    { left: "65%", size: "55px", delay: "0s", duration: "13s" },
    { left: "75%", size: "45px", delay: "6s", duration: "16s" },
    { left: "85%", size: "65px", delay: "2s", duration: "17s" },
    { left: "95%", size: "30px", delay: "4s", duration: "9s" },
    { left: "10%", size: "50px", delay: "7s", duration: "14s" },
    { left: "30%", size: "40px", delay: "8s", duration: "13s" },
    { left: "50%", size: "55px", delay: "6s", duration: "15s" },
    { left: "70%", size: "35px", delay: "9s", duration: "12s" },
    { left: "90%", size: "45px", delay: "5s", duration: "16s" },
  ];

  return (
    <div className="aero-bubbles-container fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
      {bubbles.map((bubble, i) => (
        <div
          key={i}
          className="aero-bubble absolute bottom-[-80px] rounded-full"
          style={{
            left: bubble.left,
            width: bubble.size,
            height: bubble.size,
            animationDelay: bubble.delay,
            animationDuration: bubble.duration,
          }}
        />
      ))}
    </div>
  );
}

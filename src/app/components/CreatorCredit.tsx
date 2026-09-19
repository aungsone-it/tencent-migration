import { useId, useMemo, useState } from "react";
import { useLanguage } from "../contexts/LanguageContext";
import { resolveCloudBaseMediaUrl } from "../../../utils/tencent/storageMediaUrl";

export const CREATOR_NAME = "Aung Pyae Sone";

function isCreatorName(name: string | undefined) {
  const n = String(name || "").toLowerCase();
  return n.includes("aung") && n.includes("sone");
}

function resolveCreatorAvatarUrl(user: { name?: string; profileImageUrl?: string; avatar?: string } | null | undefined) {
  if (!user || !isCreatorName(user.name)) return "";
  const raw = String(user.profileImageUrl || user.avatar || "").trim();
  if (!raw) return "";
  const resolved = resolveCloudBaseMediaUrl(raw);
  if (resolved.startsWith("http") || resolved.startsWith("data:")) return resolved;
  return raw.startsWith("http") || raw.startsWith("data:") ? raw : "";
}

function CreatorSignaturePortrait({
  src,
  name,
  onImageError,
}: {
  src?: string;
  name: string;
  onImageError?: () => void;
}) {
  const reactId = useId().replace(/:/g, "");
  const glowId = `creator-glow-${reactId}`;

  return (
    <div className="creator-signature relative h-[9.25rem] w-[9.25rem] overflow-visible">
      <div className="creator-signature-aura pointer-events-none absolute inset-[-18%] rounded-full" />

      <svg
        viewBox="0 0 140 140"
        className="creator-orbit creator-orbit-outer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e8d7b0" stopOpacity="0.15" />
            <stop offset="45%" stopColor="#c9b896" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#8b7355" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <circle
          cx="70"
          cy="70"
          r="64"
          fill="none"
          stroke={`url(#${glowId})`}
          strokeWidth="1.05"
          strokeDasharray="2.2 6.4"
        />
        <circle cx="134" cy="70" r="2.1" fill="#f3e6c8" />
        <circle cx="28" cy="18" r="1.35" fill="#e8d7b0" opacity="0.9" />
      </svg>

      <svg
        viewBox="0 0 140 140"
        className="creator-orbit creator-orbit-inner pointer-events-none absolute inset-[8%] overflow-visible"
        aria-hidden
      >
        <circle
          cx="70"
          cy="70"
          r="64"
          fill="none"
          stroke="#c9b896"
          strokeOpacity="0.72"
          strokeWidth="0.9"
        />
        <circle cx="70" cy="6" r="1.7" fill="#f8efd8" />
        <circle cx="122" cy="108" r="1.25" fill="#e8d7b0" opacity="0.9" />
      </svg>

      <div className="absolute inset-[18%] overflow-hidden rounded-full bg-slate-900 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.55)] ring-1 ring-[#c9b896]/70">
        {src ? (
          <img
            src={src}
            alt={name}
            className="h-full w-full object-cover"
            onError={onImageError}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-900 text-sm font-medium tracking-[0.22em] text-[#e8d7b0]">
            APS
          </div>
        )}
        <span className="creator-signature-sheen pointer-events-none absolute inset-0" />
      </div>

      <span className="creator-signature-mark pointer-events-none absolute right-[6%] top-[8%]" aria-hidden>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
          <path
            d="M8 1.2 9.7 6.3 14.8 8 9.7 9.7 8 14.8 6.3 9.7 1.2 8 6.3 6.3Z"
            fill="#f3e6c8"
            stroke="#c9b896"
            strokeWidth="0.4"
          />
        </svg>
      </span>
    </div>
  );
}

interface CreatorCreditProps {
  compact?: boolean;
  user?: { name?: string; profileImageUrl?: string; avatar?: string } | null;
}

export function CreatorCredit({ compact = false, user }: CreatorCreditProps) {
  const { t } = useLanguage();
  const createdBy = t("footer.createdBy");
  const role = t("footer.role");
  const photoUrl = useMemo(() => resolveCreatorAvatarUrl(user), [user]);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [active, setActive] = useState(false);
  const showPhoto = Boolean(photoUrl) && !photoFailed;

  return (
    <div
      className="relative"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      <button
        type="button"
        aria-expanded={active}
        aria-label={`${createdBy} ${CREATOR_NAME}`}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className={`w-full rounded-lg text-center outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-slate-200 ${
          compact ? "px-1 py-0.5" : "px-2 py-1"
        } ${active ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <p className={`${compact ? "text-[10px]" : "text-xs"} text-slate-400 font-medium`}>
          {createdBy}{" "}
          <span className="text-slate-600 font-semibold underline decoration-slate-300 decoration-dotted underline-offset-2">
            {CREATOR_NAME}
          </span>
        </p>
        <p className={`${compact ? "text-[10px]" : "text-xs"} text-slate-400`}>{role}</p>
      </button>

      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col items-center pb-5 text-center transition-all duration-500 ease-out ${
          active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <CreatorSignaturePortrait
          src={showPhoto ? photoUrl : undefined}
          name={CREATOR_NAME}
          onImageError={() => setPhotoFailed(true)}
        />
        <p className="mt-2 text-[13px] font-medium tracking-[0.18em] text-slate-800 uppercase">
          {CREATOR_NAME}
        </p>
        <p className="mt-0.5 text-[9px] font-medium tracking-[0.28em] text-[#8b7355] uppercase">
          {role}
        </p>
      </div>
    </div>
  );
}

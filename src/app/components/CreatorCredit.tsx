import { useMemo, useState } from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { HoverCard, HoverCardTrigger } from "./ui/hover-card";
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

function CreatorAvatar({
  src,
  name,
  onImageError,
}: {
  src?: string;
  name: string;
  onImageError?: () => void;
}) {
  return (
    <div className="creator-avatar-animate relative h-24 w-24">
      <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-white shadow-lg">
        {src ? (
          <img
            src={src}
            alt={name}
            className="h-full w-full object-cover"
            onError={onImageError}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800 text-lg font-semibold text-white">
            APS
          </div>
        )}
      </div>
      <span
        className="creator-birthday-emoji pointer-events-none absolute -right-1.5 -top-1.5 text-[28px] leading-none"
        aria-hidden
      >
        🎉
      </span>
      <span
        className="creator-birthday-cake pointer-events-none absolute -right-3 top-6 text-lg leading-none"
        aria-hidden
      >
        🎂
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
  const showPhoto = Boolean(photoUrl) && !photoFailed;

  return (
    <HoverCard openDelay={80} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={`w-full text-center rounded-lg outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-200 ${
            compact ? "px-1 py-0.5" : "px-2 py-1"
          }`}
          aria-label={`${createdBy} ${CREATOR_NAME}`}
        >
          <p className={`${compact ? "text-[10px]" : "text-xs"} text-slate-400 font-medium`}>
            {createdBy}{" "}
            <span className="text-slate-600 font-semibold underline decoration-slate-300 decoration-dotted underline-offset-2">
              {CREATOR_NAME}
            </span>
          </p>
          <p className={`${compact ? "text-[10px]" : "text-xs"} text-slate-400`}>{role}</p>
        </button>
      </HoverCardTrigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="center"
          sideOffset={8}
          className="z-50 w-auto border-0 bg-transparent p-0 shadow-none outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="flex flex-col items-center text-center">
            <CreatorAvatar
              src={showPhoto ? photoUrl : undefined}
              name={CREATOR_NAME}
              onImageError={() => setPhotoFailed(true)}
            />
            <p className="mt-2 text-sm font-semibold text-slate-800 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
              {CREATOR_NAME}
            </p>
            <p className="text-[11px] text-slate-500 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">{role}</p>
          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCard>
  );
}

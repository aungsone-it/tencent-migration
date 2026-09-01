import { lazy, Suspense } from "react";
import { EmojiStyle, Theme, type EmojiClickData } from "emoji-picker-react";

export type { EmojiClickData };

// Dynamically import the emoji picker to avoid build cache issues
const EmojiPickerReact = lazy(() => import("emoji-picker-react"));

interface EmojiPickerProps {
  onEmojiClick: (emojiData: EmojiClickData) => void;
  width?: number;
  height?: number;
}

/** Native Unicode emojis — no paid asset pack; renders with the OS emoji font. */
export function EmojiPicker({ onEmojiClick, width = 320, height = 360 }: EmojiPickerProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-8 text-sm text-slate-500">
          Loading…
        </div>
      }
    >
      <EmojiPickerReact
        onEmojiClick={onEmojiClick}
        width={width}
        height={height}
        emojiStyle={EmojiStyle.NATIVE}
        theme={Theme.LIGHT}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
      />
    </Suspense>
  );
}

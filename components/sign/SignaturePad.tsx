"use client";

import { useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Eraser, PenLine } from "lucide-react";

// Signature canvas + e-sign consent. The signer is the Contact name
// entered above (no separate name field), so it's only typed once.
// Controlled: the parent holds the values and receives the drawn PNG
// via onSignatureChange so it can both overlay it on the preview and
// submit it. Shared by the New Lead workspace and the remote page.

export function SignaturePad({
  signerName,
  consent,
  onConsent,
  sigDataUrl,
  onSignatureChange,
}: {
  signerName: string;
  consent: boolean;
  onConsent: (v: boolean) => void;
  sigDataUrl: string | null;
  onSignatureChange: (dataUrl: string | null) => void;
}) {
  const sigRef = useRef<SignatureCanvas | null>(null);

  return (
    <div className="space-y-4">
      <div className="text-xs text-mse-muted">
        Signing as{" "}
        <span className="font-bold text-mse-navy">
          {signerName.trim() || "the contact named above"}
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
            Signature — lands in every &quot;Sign here&quot; spot above
          </span>
          {sigDataUrl && (
            <button
              type="button"
              onClick={() => {
                sigRef.current?.clear();
                onSignatureChange(null);
              }}
              className="text-xs font-semibold inline-flex items-center gap-1 text-mse-muted hover:text-mse-navy"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
        <div className="rounded-2xl border-2 border-mse-navy bg-white relative overflow-hidden touch-none shadow-card">
          <SignatureCanvas
            ref={sigRef}
            onEnd={() => {
              if (sigRef.current && !sigRef.current.isEmpty()) {
                onSignatureChange(sigRef.current.toDataURL("image/png"));
              }
            }}
            penColor="#1A2332"
            clearOnResize={false}
            canvasProps={{ className: "w-full h-52 block" }}
            backgroundColor="rgba(255,255,255,0)"
          />
          {!sigDataUrl && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-mse-navy/40 text-sm font-medium">
              <PenLine className="w-4 h-4 mr-1.5" />
              Sign with your finger or stylus
            </div>
          )}
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsent(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[#1A2332]"
        />
        <span className="text-xs text-mse-navy leading-relaxed">
          I agree to sign these documents electronically, my signature will be
          applied to each signature line shown above, and I confirm I am
          authorized to sign on behalf of the business named above.
        </span>
      </label>
    </div>
  );
}

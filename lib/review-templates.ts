/**
 * Review templates the customer can copy + paste when leaving a Google
 * review. Rotated per dispatch so identical wording doesn't trigger
 * Google's spam filter (which can yank reviews and flag the listing).
 *
 * Slots:
 *   {customer} — Job.customerName (often a business name)
 *   {tech}     — first name of the lead tech on the dispatch
 *   {service}  — short description ("HVAC tune-up", "RTU service")
 *
 * Templates are intentionally a little uneven in tone/length to avoid
 * looking templated. Customers can edit before pasting.
 */
const TEMPLATES = [
  "{customer} hired MSE for our HVAC tune-up — {tech} was professional, on time, and clearly knew what he was doing. Filters and coils look great now. Highly recommend.",
  "{tech} from MSE handled our {service} today. Easy to work with, walked me through everything, and the work was clean. Will use them again.",
  "Great service from MSE — {tech} got our system running smoothly. Took photos, explained the issues, no surprises. {customer} appreciates the honest, professional work.",
  "Booked MSE for our seasonal {service}. {tech} showed up on time, did a thorough job, and was upfront about what we needed. Five stars from {customer}.",
  "Solid HVAC service from MSE — {tech} cleaned the coils, replaced our filters, and showed me the before/after photos. {customer} will be calling them again.",
] as const;

export interface TemplateInputs {
  customerName: string;
  techFirstName: string;
  serviceLabel: string;
  /** Stable seed so the same dispatch always shows the same template
   *  on re-render. We use the dispatchId, hashed to a non-negative int. */
  seed: string;
}

export function pickReviewTemplate(opts: TemplateInputs): string {
  const idx = Math.abs(hashCode(opts.seed)) % TEMPLATES.length;
  const tpl = TEMPLATES[idx];
  return tpl
    .replace(/\{customer\}/g, opts.customerName || "Our team")
    .replace(/\{tech\}/g, opts.techFirstName || "the MSE crew")
    .replace(/\{service\}/g, opts.serviceLabel || "HVAC service");
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

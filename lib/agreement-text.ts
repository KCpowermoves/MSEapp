// Agreement authorization text — shared by the public signing page and
// the generated PDF so the customer signs exactly what gets stored.
// Client-safe (no server imports).
//
// INTERIM LANGUAGE: replace with the official per-utility agreement
// text from the existing program PDFs before real-customer use.

import { UTILITY_PROGRAM_LABELS } from "@/lib/programs";
import type { Lead } from "@/lib/types";

export function agreementParagraphs(lead: {
  businessName: string;
  contactName: string;
  utility: Lead["utility"];
}): string[] {
  const business = lead.businessName || lead.contactName || "the Customer";
  const program = UTILITY_PROGRAM_LABELS[lead.utility] ?? lead.utility;
  return [
    `By signing below, the undersigned ("Customer"), on behalf of ${business}, authorizes Maryland Smart Energy ("Contractor") to enroll the service address listed above in the no-cost HVAC tune-up program associated with ${program}, and to perform the covered tune-up services on the HVAC equipment at that address.`,
    `Customer authorizes Contractor to share the account information provided on this agreement with the utility and its program administrator solely for enrollment, verification, and incentive processing under the Empower Maryland (or applicable utility) program.`,
    `The tune-up services covered by the program are provided at no cost to the Customer. Any additional repairs or services outside the program scope will only be performed with separate written approval.`,
    `Customer confirms they are authorized to sign for the business named above and consents to conducting this transaction and signature electronically.`,
  ];
}

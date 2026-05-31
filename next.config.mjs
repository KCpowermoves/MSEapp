/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle the MSE logo into serverless functions so the payroll PDF
  // generator can readFileSync it at runtime on Vercel. By default
  // Next's serverless tracer only includes files referenced via
  // import/require — anything pulled from disk dynamically (like
  // public assets read by API routes) has to be opted in here.
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/payroll/**/*": ["./public/logo.png"],
      "/api/payroll/**/*": ["./public/logo.png"],
    },
  },
};

export default nextConfig;

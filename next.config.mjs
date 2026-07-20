/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The agreement packet engine reads the source PDFs from Forms/ at
    // runtime — include them in the serverless bundle for the routes
    // that build signed packets.
    outputFileTracingIncludes: {
      "/api/sign/[token]": ["./Forms/**"],
    },
  },
};

export default nextConfig;

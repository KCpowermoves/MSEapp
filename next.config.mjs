/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The agreement packet engine reads the source PDFs from Forms/ at
    // runtime — include them in the serverless bundle for the routes
    // that build signed packets.
    outputFileTracingIncludes: {
      "/api/sign/[token]": ["./Forms/**"],
      // Engineering routes read their templates from disk at runtime —
      // bundle them into the serverless function or the read 404s on
      // Vercel even though the files are committed.
      "/api/admin/engineering/[id]/xlsx": ["./engineering/template-*.xlsx"],
      "/api/admin/engineering/[id]/sow": ["./engineering/sow-template.docx"],
    },
  },
};

export default nextConfig;

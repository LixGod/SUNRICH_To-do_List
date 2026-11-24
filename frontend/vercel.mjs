const apiOrigin = process.env.API_ORIGIN?.replace(/\/$/, '');

if (apiOrigin && !/^https:\/\/[^/]+$/.test(apiOrigin)) {
  throw new Error('Set API_ORIGIN to the public HTTPS URL of the Railway backend.');
}

export const config = {
  buildCommand: 'npm run build',
  outputDirectory: 'dist/sunrich-todo-frontend/browser',
  rewrites: [
    ...(apiOrigin ? [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }] : []),
    { source: '/:path*', destination: '/index.html' }
  ]
};

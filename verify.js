import { createServer } from 'vite';

async function main() {
  const server = await createServer();
  try {
    await server.ssrLoadModule('./verify_levels.ts');
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

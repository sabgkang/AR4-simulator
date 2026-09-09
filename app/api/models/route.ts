import path from 'node:path';
import { readModelFile, storeModelFile } from '../../robot-simulator/scene-storage';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'A model file is required.' }, { status: 400 });
    const relativePath = await storeModelFile(file.name, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ path: relativePath });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not store the model.' }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const relativePath = new URL(request.url).searchParams.get('path');
    if (!relativePath) return Response.json({ error: 'A model path is required.' }, { status: 400 });
    const bytes = await readModelFile(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const contentType = extension === '.stl' ? 'model/stl' : 'application/step';
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return Response.json({ error: error instanceof Error ? error.message : 'Could not read the model.' }, { status: code === 'ENOENT' ? 404 : 400 });
  }
}

import { storeSceneFile } from '../../robot-simulator/scene-storage';

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { filename?: unknown; content?: unknown; overwrite?: unknown };
    if (typeof payload.filename !== 'string' || !payload.filename.trim()) {
      return Response.json({ error: 'A scene filename is required.' }, { status: 400 });
    }
    if (typeof payload.content !== 'string') return Response.json({ error: 'Scene content is required.' }, { status: 400 });
    JSON.parse(payload.content);
    const filename = await storeSceneFile(payload.filename, payload.content, payload.overwrite === true);
    return Response.json({ filename, path: `Scenes/${filename}` });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return Response.json({ error: 'A scene with this filename already exists.' }, { status: 409 });
    }
    return Response.json({ error: error instanceof Error ? error.message : 'Could not save the scene.' }, { status: 400 });
  }
}

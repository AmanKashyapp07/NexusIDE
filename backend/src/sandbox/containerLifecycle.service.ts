import type Docker from 'dockerode';
import tar from 'tar-stream';
import type { QueryResultRow } from 'pg';

export const RUN_SCRIPT = `#!/bin/sh
if [ -z "$1" ]; then echo "Usage: run <filename>"; exit 1; fi
file="$1"; ext="\${file##*.}"
case "$ext" in
  py) python3 "$file" ;;
  js) node "$file" ;;
  c) gcc "$file" -o /tmp/a.out && /tmp/a.out ;;
  cpp) g++ "$file" -o /tmp/a.out && /tmp/a.out ;;
  java) javac "$file" -d /tmp && java -cp /tmp "\${file%.*}" ;;
  sh) sh "$file" ;;
  *) echo "Unsupported: .$ext"; exit 1 ;;
esac`;

export interface FileRecord extends QueryResultRow {
   type: string;
   content?: string | null;
   path: string;
}

export async function populateContainerWorkspace(
   container: Docker.Container,
   wsContainerPath: string,
   files: FileRecord[]
): Promise<void> {
   const pack = tar.pack();
   for (const file of files) {
      if (file.type === 'file') {
         pack.entry({ name: file.path }, file.content || '');
      } else {
         pack.entry({ name: file.path, type: 'directory' });
      }
   }
   pack.entry({ name: '.run.sh' }, RUN_SCRIPT);
   pack.finalize();

   const exec = await container.exec({ 
      Cmd: ['tar', '-x', '-C', wsContainerPath], 
      AttachStdin: true, 
      AttachStdout: true, 
      AttachStderr: true 
   });
   const stream = await exec.start({ hijack: true, stdin: true });
   
   await new Promise<void>((resolve, reject) => {
      pack.pipe(stream);
      stream.on('end', resolve);
      stream.on('error', reject);
      pack.on('error', reject);
   });
}

export async function runContainerSetupScripts(
   container: Docker.Container,
   wsContainerPath: string
): Promise<void> {
   const setupExec = await container.exec({ 
      Cmd: ['sh', '-c', `cp ${wsContainerPath}/.run.sh /usr/local/bin/run && chmod +x /usr/local/bin/run && rm -f ${wsContainerPath}/.run.sh`] 
   });
   const setupStream = await setupExec.start({ hijack: true, stdin: false });
   await new Promise<void>((res) => { 
      setupStream.on('end', res); 
      setupStream.on('error', res); 
   });

   const installExec = await container.exec({ 
      Cmd: ['sh', '-c', `cd ${wsContainerPath} && if [ -f package.json ] && [ ! -d node_modules ]; then npm install; fi`] 
   });
   installExec.start({ Detach: true, hijack: false }).catch(() => {});
}

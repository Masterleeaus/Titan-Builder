throw new Error(
  'Built-in skill entrypoint modules must be resolved through the Titan Builder closed runtime dispatcher.',
);

export function resolveProjectPath() {
  throw new Error('Built-in skill entrypoints must be invoked through the Titan Builder closed runtime dispatcher.');
}

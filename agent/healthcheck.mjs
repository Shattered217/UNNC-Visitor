try {
  const response = await fetch("http://127.0.0.1:8080/health", { signal: AbortSignal.timeout(4000) });
  if (!response.ok) process.exitCode = 1;
} catch { process.exitCode = 1; }

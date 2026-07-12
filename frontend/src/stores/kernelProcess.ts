export const resolveCoreStopPid = async (
  currentPid: number,
  controllerPort: number,
  findListeningProcess: (port: number) => Promise<number>,
  readPidFile?: () => Promise<string>,
) => {
  if (currentPid > 0) {
    return currentPid
  }

  try {
    return await findListeningProcess(controllerPort)
  } catch (error) {
    if (!readPidFile) throw error

    const pid = Number(await readPidFile().catch(() => -1))
    if (pid > 0) return pid

    throw error
  }
}

export const resolveCoreStopPid = async (
  currentPid: number,
  controllerPort: number,
  findListeningProcess: (port: number) => Promise<number>,
) => {
  if (currentPid > 0) {
    return currentPid
  }

  return findListeningProcess(controllerPort)
}

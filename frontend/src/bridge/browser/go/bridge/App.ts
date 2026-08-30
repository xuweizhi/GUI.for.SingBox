import { invokeBridge } from '../../shared/webui'

type FlagResult = {
  flag: boolean
  data: string
}

type HTTPResult = {
  flag: boolean
  status: number
  headers: Record<string, string[]>
  body: string
}

const flagResult = (method: string, args: unknown[] = []) => invokeBridge<FlagResult>(method, args)

export const AbsolutePath = (arg1: string) => flagResult('AbsolutePath', [arg1])
export const CloseMMDB = (arg1: string, arg2: string) => flagResult('CloseMMDB', [arg1, arg2])
export const CopyFile = (arg1: string, arg2: string) => flagResult('CopyFile', [arg1, arg2])
export const ClearScheduledTaskWorkerLogs = () => flagResult('ClearScheduledTaskWorkerLogs')
export const Download = (
  arg1: string,
  arg2: string,
  arg3: string,
  arg4: Record<string, string>,
  arg5: string,
  arg6: Record<string, any>,
) => invokeBridge<HTTPResult>('Download', [arg1, arg2, arg3, arg4, arg5, arg6])
export const Exec = (arg1: string, arg2: string[], arg3: Record<string, any>) =>
  flagResult('Exec', [arg1, arg2, arg3])
export const ExecBackground = (
  arg1: string,
  arg2: string[],
  arg3: string,
  arg4: string,
  arg5: Record<string, any>,
) => flagResult('ExecBackground', [arg1, arg2, arg3, arg4, arg5])
export const FileExists = (arg1: string) => flagResult('FileExists', [arg1])
export const FileSHA256 = (arg1: string) => flagResult('FileSHA256', [arg1])
export const FindListeningProcess = (arg1: number) => flagResult('FindListeningProcess', [arg1])
export const GetEnv = () => invokeBridge<any>('GetEnv')
export const GetInterfaces = () => flagResult('GetInterfaces')
export const GetScheduledTaskWorkerLogs = () => flagResult('GetScheduledTaskWorkerLogs')
export const GetScheduledTaskWorkerStatus = () => flagResult('GetScheduledTaskWorkerStatus')
export const GetSystemProxy = () => flagResult('GetSystemProxy')
export const GetSystemProxyBypass = () => flagResult('GetSystemProxyBypass')
export const IsStartup = () => invokeBridge<boolean>('IsStartup')
export const KillProcess = (arg1: number, arg2: number) => flagResult('KillProcess', [arg1, arg2])
export const ListServer = () => flagResult('ListServer')
export const MakeDir = (arg1: string) => flagResult('MakeDir', [arg1])
export const MoveFile = (arg1: string, arg2: string) => flagResult('MoveFile', [arg1, arg2])
export const OpenMMDB = (arg1: string, arg2: string) => flagResult('OpenMMDB', [arg1, arg2])
export const ProcessInfo = (arg1: number) => flagResult('ProcessInfo', [arg1])
export const ProcessMemory = (arg1: number) => flagResult('ProcessMemory', [arg1])
export const QueryMMDB = (arg1: string, arg2: string, arg3: string) =>
  flagResult('QueryMMDB', [arg1, arg2, arg3])
export const ReadDir = (arg1: string) => flagResult('ReadDir', [arg1])
export const ReadFile = (arg1: string, arg2: Record<string, any>) =>
  flagResult('ReadFile', [arg1, arg2])
export const RecordScheduledTaskLog = (arg1: string) => flagResult('RecordScheduledTaskLog', [arg1])
export const ReloadScheduledTaskWorker = () => flagResult('ReloadScheduledTaskWorker')
export const RemoveFile = (arg1: string) => flagResult('RemoveFile', [arg1])
export const Requests = (
  arg1: string,
  arg2: string,
  arg3: Record<string, string>,
  arg4: string,
  arg5: Record<string, any>,
) => invokeBridge<HTTPResult>('Requests', [arg1, arg2, arg3, arg4, arg5])
export const RestartApp = () => flagResult('RestartApp')
export const RunScheduledTaskWorker = (arg1: string) => flagResult('RunScheduledTaskWorker', [arg1])
export const StartServer = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  flagResult('StartServer', [arg1, arg2, arg3])
export const StopServer = (arg1: string) => flagResult('StopServer', [arg1])
export const TcpPing = (arg1: string, arg2: Record<string, any>) =>
  flagResult('TcpPing', [arg1, arg2])
export const TcpRequest = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  flagResult('TcpRequest', [arg1, arg2, arg3])
export const UdpRequest = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  flagResult('UdpRequest', [arg1, arg2, arg3])
export const UnzipGZFile = (arg1: string, arg2: string) => flagResult('UnzipGZFile', [arg1, arg2])
export const UnzipTarGZFile = (arg1: string, arg2: string) =>
  flagResult('UnzipTarGZFile', [arg1, arg2])
export const UnzipZIPFile = (arg1: string, arg2: string) => flagResult('UnzipZIPFile', [arg1, arg2])
export const Upload = (
  arg1: string,
  arg2: string,
  arg3: string,
  arg4: Record<string, string>,
  arg5: string,
  arg6: Record<string, any>,
) => invokeBridge<HTTPResult>('Upload', [arg1, arg2, arg3, arg4, arg5, arg6])
export const WriteFile = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  flagResult('WriteFile', [arg1, arg2, arg3])

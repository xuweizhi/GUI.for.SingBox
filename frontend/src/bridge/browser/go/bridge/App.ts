import { invokeBridge } from '../../shared/webui'

export const AbsolutePath = (arg1: string) => invokeBridge('AbsolutePath', [arg1])
export const CloseMMDB = (arg1: string, arg2: string) => invokeBridge('CloseMMDB', [arg1, arg2])
export const CopyFile = (arg1: string, arg2: string) => invokeBridge('CopyFile', [arg1, arg2])
export const Download = (
  arg1: string,
  arg2: string,
  arg3: string,
  arg4: Record<string, string>,
  arg5: string,
  arg6: Record<string, any>,
) => invokeBridge('Download', [arg1, arg2, arg3, arg4, arg5, arg6])
export const Exec = (arg1: string, arg2: string[], arg3: Record<string, any>) =>
  invokeBridge('Exec', [arg1, arg2, arg3])
export const ExecBackground = (
  arg1: string,
  arg2: string[],
  arg3: string,
  arg4: string,
  arg5: Record<string, any>,
) => invokeBridge('ExecBackground', [arg1, arg2, arg3, arg4, arg5])
export const ExitApp = () => invokeBridge<void>('ExitApp')
export const FileExists = (arg1: string) => invokeBridge('FileExists', [arg1])
export const FindListeningProcess = (arg1: number) => invokeBridge('FindListeningProcess', [arg1])
export const GetEnv = (arg1: string) => invokeBridge('GetEnv', [arg1])
export const GetInterfaces = () => invokeBridge('GetInterfaces')
export const IsStartup = () => invokeBridge<boolean>('IsStartup')
export const KillProcess = (arg1: number, arg2: number) => invokeBridge('KillProcess', [arg1, arg2])
export const ListServer = () => invokeBridge('ListServer')
export const MakeDir = (arg1: string) => invokeBridge('MakeDir', [arg1])
export const MoveFile = (arg1: string, arg2: string) => invokeBridge('MoveFile', [arg1, arg2])
export const OpenDir = (arg1: string) => invokeBridge('OpenDir', [arg1])
export const OpenMMDB = (arg1: string, arg2: string) => invokeBridge('OpenMMDB', [arg1, arg2])
export const OpenURI = (arg1: string) => invokeBridge('OpenURI', [arg1])
export const ProcessInfo = (arg1: number) => invokeBridge('ProcessInfo', [arg1])
export const ProcessMemory = (arg1: number) => invokeBridge('ProcessMemory', [arg1])
export const QueryMMDB = (arg1: string, arg2: string, arg3: string) =>
  invokeBridge('QueryMMDB', [arg1, arg2, arg3])
export const ReadDir = (arg1: string) => invokeBridge('ReadDir', [arg1])
export const ReadFile = (arg1: string, arg2: Record<string, any>) =>
  invokeBridge('ReadFile', [arg1, arg2])
export const RemoveFile = (arg1: string) => invokeBridge('RemoveFile', [arg1])
export const Requests = (
  arg1: string,
  arg2: string,
  arg3: Record<string, string>,
  arg4: string,
  arg5: Record<string, any>,
) => invokeBridge('Requests', [arg1, arg2, arg3, arg4, arg5])
export const RestartApp = () => invokeBridge('RestartApp')
export const ShowMainWindow = () => invokeBridge<void>('ShowMainWindow')
export const StartServer = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  invokeBridge('StartServer', [arg1, arg2, arg3])
export const StopServer = (arg1: string) => invokeBridge('StopServer', [arg1])
export const TcpPing = (arg1: string, arg2: Record<string, any>) => invokeBridge('TcpPing', [arg1, arg2])
export const TcpRequest = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  invokeBridge('TcpRequest', [arg1, arg2, arg3])
export const UdpRequest = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  invokeBridge('UdpRequest', [arg1, arg2, arg3])
export const UnzipGZFile = (arg1: string, arg2: string) => invokeBridge('UnzipGZFile', [arg1, arg2])
export const UnzipTarGZFile = (arg1: string, arg2: string) =>
  invokeBridge('UnzipTarGZFile', [arg1, arg2])
export const UnzipZIPFile = (arg1: string, arg2: string) => invokeBridge('UnzipZIPFile', [arg1, arg2])
export const UpdateTray = (arg1: Record<string, any>) => invokeBridge<void>('UpdateTray', [arg1])
export const UpdateTrayAndMenus = (arg1: Record<string, any>, arg2: Record<string, any>[]) =>
  invokeBridge<void>('UpdateTrayAndMenus', [arg1, arg2])
export const UpdateTrayMenus = (arg1: Record<string, any>[]) =>
  invokeBridge<void>('UpdateTrayMenus', [arg1])
export const Upload = (
  arg1: string,
  arg2: string,
  arg3: string,
  arg4: Record<string, string>,
  arg5: string,
  arg6: Record<string, any>,
) => invokeBridge('Upload', [arg1, arg2, arg3, arg4, arg5, arg6])
export const WriteFile = (arg1: string, arg2: string, arg3: Record<string, any>) =>
  invokeBridge('WriteFile', [arg1, arg2, arg3])

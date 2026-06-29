import Foundation
import PAGAdSDK

/// Pangle SDK の起動時初期化（広告表示ロジックは別フェーズ）
enum PangleSdkBootstrap {
    static func configureIfNeeded() {
        PangleDiagnostics.logStartupContext(source: "bootstrap")

        guard let appId = PangleDiagnostics.infoPlistAppId() else {
            NSLog("[Pangle] bootstrap skipped: PangleAppId is empty in Info.plist (JS initialize() appId will be used if provided)")
            return
        }

        let config = PAGConfig.share()
        config.appID = appId
        PangleDiagnostics.applyDebugConfig(config, source: "bootstrap")

        NSLog("[Pangle] bootstrap PAGSdk.start appId=\(PangleDiagnostics.formatAppIdForLog(appId))")

        PAGSdk.start(with: config) { success, error in
            if success {
                NSLog("[Pangle] bootstrap SDK initialized (version: \(PAGSdk.sdkVersion))")
            } else {
                NSLog("[Pangle] bootstrap SDK init failed: \(PangleDiagnostics.describeError(error))")
                if let error {
                    PangleDiagnostics.logNSError(error, context: "bootstrap SDK init")
                }
            }
        }
    }
}

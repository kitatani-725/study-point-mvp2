import Foundation
import PAGAdSDK

/// Pangle 実装確認用の診断ログ（本番リリース前に debugLog を見直すこと）
enum PangleDiagnostics {
    static func infoPlistAppId() -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "PangleAppId") as? String else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func logStartupContext(source: String) {
        let plistAppId = infoPlistAppId()
        NSLog("[Pangle] \(source) Info.plist PangleAppId=\(plistAppId ?? "(empty or missing)")")
        NSLog("[Pangle] \(source) PAGSdk.sdkVersion=\(PAGSdk.sdkVersion)")
        NSLog("[Pangle] \(source) bundleId=\(Bundle.main.bundleIdentifier ?? "unknown")")
    }

    static func formatPlacementIdForLog(_ placementId: String) -> String {
        if placementId.count <= 4 {
            return placementId
        }
        return "\(placementId) (last4=\(placementId.suffix(4)))"
    }

    static func formatAppIdForLog(_ appId: String) -> String {
        if appId.count <= 4 {
            return appId
        }
        return "\(appId) (last4=\(appId.suffix(4)))"
    }

    static func applyDebugConfig(_ config: PAGConfig, source: String) {
        config.debugLog = true
        NSLog("[Pangle] \(source) debugLog=true (Pangle SDK verbose logging enabled)")
    }

    static func logNSError(_ error: Error, context: String) {
        let nsError = error as NSError
        NSLog("[Pangle] \(context) error.localizedDescription=\(nsError.localizedDescription)")
        NSLog("[Pangle] \(context) NSError domain=\(nsError.domain) code=\(nsError.code)")
        NSLog("[Pangle] \(context) NSError userInfo=\(nsError.userInfo)")

        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            NSLog(
                "[Pangle] \(context) underlying NSError domain=\(underlying.domain) code=\(underlying.code) userInfo=\(underlying.userInfo)"
            )
        }
    }

    static func describeError(_ error: Error?) -> String {
        guard let error else { return "nil" }
        let nsError = error as NSError
        return "domain=\(nsError.domain) code=\(nsError.code) desc=\(nsError.localizedDescription) userInfo=\(nsError.userInfo)"
    }
}

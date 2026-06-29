import Foundation
import Capacitor
import PAGAdSDK

@objc(StudyPointPangleAdsPlugin)
public class StudyPointPangleAdsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StudyPointPangleAdsPlugin"
    public let jsName = "StudyPointPangleAds"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroyBanner", returnType: CAPPluginReturnPromise),
    ]

    @objc func initialize(_ call: CAPPluginCall) {
        PangleDiagnostics.logStartupContext(source: "plugin.initialize")

        let jsAppId = call.getString("appId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let plistAppId = PangleDiagnostics.infoPlistAppId()
        let appId = (jsAppId?.isEmpty == false ? jsAppId : nil)
            ?? plistAppId
            ?? ""

        NSLog("[Pangle] plugin.initialize jsAppId=\(jsAppId.map(PangleDiagnostics.formatAppIdForLog) ?? "(not passed)")")
        NSLog("[Pangle] plugin.initialize using appId=\(appId.isEmpty ? "(empty)" : PangleDiagnostics.formatAppIdForLog(appId))")

        guard !appId.isEmpty else {
            NSLog("[Pangle] initialize rejected: missing_app_id (set PangleAppId in Info.plist or pass appId from JS)")
            call.reject("missing_app_id")
            return
        }

        if let plistAppId, let jsAppId, !jsAppId.isEmpty, plistAppId != jsAppId {
            NSLog("[Pangle] plugin.initialize WARNING appId mismatch plist=\(PangleDiagnostics.formatAppIdForLog(plistAppId)) js=\(PangleDiagnostics.formatAppIdForLog(jsAppId))")
        }

        let config = PAGConfig.share()
        config.appID = appId
        PangleDiagnostics.applyDebugConfig(config, source: "plugin.initialize")

        PAGSdk.start(with: config) { success, error in
            if success {
                NSLog("[Pangle] plugin.initialize complete appId=\(PangleDiagnostics.formatAppIdForLog(appId)) sdkVersion=\(PAGSdk.sdkVersion)")
                call.resolve(["success": true])
            } else {
                NSLog("[Pangle] plugin.initialize failed: \(PangleDiagnostics.describeError(error))")
                if let error {
                    PangleDiagnostics.logNSError(error, context: "plugin.initialize")
                }
                call.reject(error?.localizedDescription ?? "pangle_init_failed")
            }
        }
    }

    @objc func loadBanner(_ call: CAPPluginCall) {
        guard let placementId = call.getString("placementId"),
              let placementKey = call.getString("placementKey") else {
            NSLog("[Pangle] loadBanner rejected: missing_placement")
            call.reject("missing_placement")
            return
        }

        let jsAppId = call.getString("appId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        NSLog("[Pangle] loadBanner placementKey=\(placementKey) placementId=\(PangleDiagnostics.formatPlacementIdForLog(placementId))")
        NSLog("[Pangle] loadBanner jsAppId=\(jsAppId.map(PangleDiagnostics.formatAppIdForLog) ?? "(not passed)") Info.plist PangleAppId=\(PangleDiagnostics.infoPlistAppId() ?? "(empty)")")

        guard let viewController = bridge?.viewController else {
            NSLog("[Pangle] loadBanner rejected: no_view_controller")
            call.reject("no_view_controller")
            return
        }

        let width = call.getInt("width") ?? 320
        let height = call.getInt("height") ?? 50
        let x = CGFloat(call.getDouble("x") ?? 0)
        let y = CGFloat(call.getDouble("y") ?? 0)

        PangleBannerManager.shared.loadBanner(
            placementKey: placementKey,
            placementId: placementId,
            width: width,
            height: height,
            x: x,
            y: y,
            rootViewController: viewController
        ) { success, errorMessage, errorDetails in
            if success {
                call.resolve(["success": true])
            } else {
                NSLog("[Pangle] loadBanner resolve failed placementKey=\(placementKey) error=\(errorMessage ?? "load_failed") details=\(errorDetails ?? "n/a")")
                call.resolve([
                    "success": false,
                    "error": errorMessage ?? "load_failed",
                    "errorDetails": errorDetails ?? "",
                ])
            }
        }
    }

    @objc func showBanner(_ call: CAPPluginCall) {
        guard let placementKey = call.getString("placementKey") else {
            call.reject("missing_placement_key")
            return
        }
        PangleBannerManager.shared.showBanner(placementKey: placementKey)
        call.resolve(["success": true])
    }

    @objc func hideBanner(_ call: CAPPluginCall) {
        guard let placementKey = call.getString("placementKey") else {
            call.reject("missing_placement_key")
            return
        }
        PangleBannerManager.shared.hideBanner(placementKey: placementKey)
        call.resolve(["success": true])
    }

    @objc func destroyBanner(_ call: CAPPluginCall) {
        guard let placementKey = call.getString("placementKey") else {
            call.reject("missing_placement_key")
            return
        }
        PangleBannerManager.shared.destroyBanner(placementKey: placementKey)
        call.resolve(["success": true])
    }
}

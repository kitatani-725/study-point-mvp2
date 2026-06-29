import Foundation
import UIKit
import PAGAdSDK

private final class PangleBannerSlot {
    var bannerAd: PAGBannerAd?
    var bannerView: UIView?
    let placementKey: String

    init(placementKey: String) {
        self.placementKey = placementKey
    }
}

/// placementKey ごとに Pangle バナーを保持・配置
final class PangleBannerManager: NSObject {
    static let shared = PangleBannerManager()

    private var slots: [String: PangleBannerSlot] = [:]

    private override init() {
        super.init()
    }

    func loadBanner(
        placementKey: String,
        placementId: String,
        width: Int,
        height: Int,
        x: CGFloat,
        y: CGFloat,
        rootViewController: UIViewController,
        completion: @escaping (Bool, String?, String?) -> Void
    ) {
        destroyBanner(placementKey: placementKey)

        let request = PAGBannerRequest(bannerSize: Self.bannerSize(width: width, height: height))

        NSLog("[Pangle] banner load start placementKey=\(placementKey) placementId=\(PangleDiagnostics.formatPlacementIdForLog(placementId)) frame=(\(x),\(y)) size=\(width)x\(height)")

        PAGBannerAd.load(withSlotID: placementId, request: request) { [weak self] bannerAd, error in
            DispatchQueue.main.async {
                guard let self else { return }

                if let error {
                    let details = PangleDiagnostics.describeError(error)
                    NSLog("[Pangle] banner load failed placementKey=\(placementKey) placementId=\(PangleDiagnostics.formatPlacementIdForLog(placementId))")
                    PangleDiagnostics.logNSError(error, context: "banner load")
                    completion(false, error.localizedDescription, details)
                    return
                }

                guard let bannerAd else {
                    NSLog("[Pangle] banner load failed placementKey=\(placementKey) placementId=\(PangleDiagnostics.formatPlacementIdForLog(placementId)) error=banner_ad_nil")
                    completion(false, "banner_ad_nil", "banner_ad_nil")
                    return
                }

                bannerAd.rootViewController = rootViewController
                let bannerView = bannerAd.bannerView
                let adSize = bannerAd.adSize.size
                bannerView.frame = CGRect(
                    x: x,
                    y: y,
                    width: adSize.width > 0 ? adSize.width : CGFloat(width),
                    height: adSize.height > 0 ? adSize.height : CGFloat(height)
                )
                bannerView.isHidden = false
                rootViewController.view.addSubview(bannerView)
                rootViewController.view.bringSubviewToFront(bannerView)

                let slot = PangleBannerSlot(placementKey: placementKey)
                slot.bannerAd = bannerAd
                slot.bannerView = bannerView
                self.slots[placementKey] = slot

                NSLog("[Pangle] banner loaded placementKey=\(placementKey) placementId=\(PangleDiagnostics.formatPlacementIdForLog(placementId)) viewFrame=\(bannerView.frame)")
                completion(true, nil, nil)
            }
        }
    }

    func showBanner(placementKey: String) {
        DispatchQueue.main.async {
            self.slots[placementKey]?.bannerView?.isHidden = false
        }
    }

    func hideBanner(placementKey: String) {
        DispatchQueue.main.async {
            self.slots[placementKey]?.bannerView?.isHidden = true
        }
    }

    func destroyBanner(placementKey: String) {
        DispatchQueue.main.async {
            guard let slot = self.slots.removeValue(forKey: placementKey) else { return }
            slot.bannerView?.removeFromSuperview()
            slot.bannerAd = nil
            slot.bannerView = nil
            NSLog("[Pangle] banner destroyed placementKey=\(placementKey)")
        }
    }

    private static func bannerSize(width: Int, height: Int) -> PAGBannerAdSize {
        if width == 320 && height == 50 {
            return kPAGBannerSize320x50
        }
        if width == 300 && height == 250 {
            return kPAGBannerSize300x250
        }
        return kPAGBannerSize320x50
    }
}

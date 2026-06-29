import UIKit
import Capacitor

/// Capacitor 8: アプリ内ローカルプラグインは capacitorDidLoad で手動登録する
class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StudyPointPangleAdsPlugin())
    }
}

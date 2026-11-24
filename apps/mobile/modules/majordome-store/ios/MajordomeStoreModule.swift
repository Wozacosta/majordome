import ExpoModulesCore
import StoreKit

private struct StoreProblem: LocalizedError {
  let errorDescription: String?
}

/// StoreKit 2 for the one subscription Majordome sells. Only purchases the App Store has signed
/// are handed to the app, and the service still asks Apple about each one itself.
public final class MajordomeStoreModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("MajordomeStore")
    Events("purchase")

    OnStartObserving {
      self.updates = Task { [weak self] in
        for await update in Transaction.updates {
          if case .verified(let transaction) = update {
            self?.sendEvent("purchase", Self.describe(transaction))
          }
        }
      }
    }

    OnStopObserving {
      self.updates?.cancel()
      self.updates = nil
    }

    AsyncFunction("product") { (id: String) -> [String: Any?]? in
      guard let product = try await Product.products(for: [id]).first,
        let subscription = product.subscription
      else { return nil }
      let intro = subscription.introductoryOffer
      return [
        "displayPrice": product.displayPrice,
        "subscriptionPeriodUnitIOS": Self.name(subscription.subscriptionPeriod.unit),
        "subscriptionPeriodNumberIOS": String(subscription.subscriptionPeriod.value),
        "introductoryPricePaymentModeIOS": intro?.paymentMode == .freeTrial ? "free-trial" : "empty",
        "introductoryPriceNumberOfPeriodsIOS": intro.map { String($0.period.value * $0.periodCount) },
        "introductoryPriceSubscriptionPeriodIOS": intro.map { Self.name($0.period.unit) },
        "trialOpen": await subscription.isEligibleForIntroOffer,
      ]
    }

    AsyncFunction("buy") { (id: String, appAccountToken: String) -> [String: Any?] in
      guard let token = UUID(uuidString: appAccountToken),
        let product = try await Product.products(for: [id]).first
      else { throw StoreProblem(errorDescription: "The App Store does not list this product.") }
      switch try await product.purchase(options: [.appAccountToken(token)]) {
      case .success(.verified(let transaction)):
        return ["outcome": "purchased", "purchase": Self.describe(transaction)]
      case .success(.unverified):
        throw StoreProblem(errorDescription: "The App Store's answer could not be checked.")
      case .pending:
        return ["outcome": "pending", "purchase": nil]
      case .userCancelled:
        return ["outcome": "cancelled", "purchase": nil]
      @unknown default:
        throw StoreProblem(errorDescription: "The App Store gave an answer this app does not know.")
      }
    }

    AsyncFunction("unfinished") { () -> [[String: Any?]] in
      var found: [[String: Any?]] = []
      for await entry in Transaction.unfinished {
        if case .verified(let transaction) = entry { found.append(Self.describe(transaction)) }
      }
      return found
    }

    AsyncFunction("owned") { (askAppStore: Bool) -> [[String: Any?]] in
      if askAppStore { try await AppStore.sync() }
      var found: [[String: Any?]] = []
      for await entry in Transaction.currentEntitlements {
        if case .verified(let transaction) = entry { found.append(Self.describe(transaction)) }
      }
      return found
    }

    AsyncFunction("finish") { (transactionId: String) in
      for await entry in Transaction.unfinished {
        if case .verified(let transaction) = entry, String(transaction.id) == transactionId {
          await transaction.finish()
        }
      }
    }
  }

  private static func describe(_ transaction: StoreKit.Transaction) -> [String: Any?] {
    [
      "productId": transaction.productID,
      "purchaseState": transaction.revocationDate == nil ? "purchased" : "revoked",
      "transactionId": String(transaction.id),
      "originalTransactionIdentifierIOS": String(transaction.originalID),
    ]
  }

  private static func name(_ unit: Product.SubscriptionPeriod.Unit) -> String {
    switch unit {
    case .day: return "day"
    case .week: return "week"
    case .month: return "month"
    case .year: return "year"
    @unknown default: return ""
    }
  }
}

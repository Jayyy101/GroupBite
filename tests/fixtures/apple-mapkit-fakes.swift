// Deterministic stand-ins. This executable imports Foundation only, never MapKit.
import Foundation

private final class Promise {
  var value: Any?
  var code: String?
  var message: String?
  var settlements = 0
  func resolve(_ value: Any?) { self.value = value; settlements += 1 }
  func reject(_ code: String, _ message: String) { self.code = code; self.message = message; settlements += 1 }
}
private struct CLLocationCoordinate2D { var latitude: Double; var longitude: Double }
private func CLLocationCoordinate2DIsValid(_ coordinate: CLLocationCoordinate2D) -> Bool {
  coordinate.latitude.isFinite && coordinate.longitude.isFinite && abs(coordinate.latitude) <= 90 && abs(coordinate.longitude) <= 180
}
private struct MKCoordinateRegion {
  var center: CLLocationCoordinate2D
  init(center: CLLocationCoordinate2D = .init(latitude: 0, longitude: 0), latitudinalMeters: Double = 0, longitudinalMeters: Double = 0) { self.center = center }
}
private struct ResultTypes: OptionSet {
  let rawValue: Int
  static let address = ResultTypes(rawValue: 1), pointOfInterest = ResultTypes(rawValue: 2), query = ResultTypes(rawValue: 4)
}
private protocol MKLocalSearchCompleterDelegate: AnyObject {
  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter)
  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error)
}
private final class MKLocalSearchCompletion {
  let title: String, subtitle: String
  init(_ title: String, _ subtitle: String = "Synthetic address") { self.title = title; self.subtitle = subtitle }
}
private final class MKLocalSearchCompleter: NSObject {
  static var instances: [MKLocalSearchCompleter] = []
  weak var delegate: MKLocalSearchCompleterDelegate?
  var region = MKCoordinateRegion(), resultTypes: ResultTypes = [], results: [MKLocalSearchCompletion] = []
  var isSearching = false, cancelled = false
  var queryFragment = "" { didSet { isSearching = true } }
  override init() { super.init(); Self.instances.append(self) }
  func cancel() { cancelled = true; isSearching = false }
  func update(_ results: [MKLocalSearchCompletion], searching: Bool = false) {
    self.results = results; isSearching = searching; delegate?.completerDidUpdateResults(self)
  }
}
private struct PostalAddress { var text: String }
private enum CNPostalAddressFormatter {
  enum Style { case mailingAddress }
  static func string(from address: PostalAddress, style: Style) -> String { address.text }
}
private struct Placemark {
  var coordinate = CLLocationCoordinate2D(latitude: 37.553, longitude: -121.980)
  var postalAddress: PostalAddress? = PostalAddress(text: "Synthetic address\nFremont")
  var title: String? = "Synthetic address"
}
private struct MapItem { var name: String? = "Synthetic restaurant"; var placemark = Placemark() }
private struct SearchResponse { var mapItems: [MapItem] }
private struct MKError: Error { enum Code { case placemarkNotFound, serverFailure }; var code: Code }
private final class MKLocalSearch {
  final class Request {
    var naturalLanguageQuery: String?, region = MKCoordinateRegion(), resultTypes: ResultTypes = []
    var completion: MKLocalSearchCompletion?
    init() {}
    init(completion: MKLocalSearchCompletion) { self.completion = completion }
  }
  static var instances: [MKLocalSearch] = []
  let request: Request
  var cancelled = false
  var callback: ((SearchResponse?, Error?) -> Void)?
  init(request: Request) { self.request = request; Self.instances.append(self) }
  func start(completionHandler: @escaping (SearchResponse?, Error?) -> Void) { callback = completionHandler }
  func cancel() { cancelled = true }
  func finish(_ items: [MapItem] = [MapItem()], error: Error? = nil) { callback?(SearchResponse(mapItems: items), error) }
}

// ENGINE_INSERTION_POINT

private func runTests() {
  var passed = 0
  func check(_ name: String, _ body: () -> Void) { body(); passed += 1; print("PASS " + name) }
  func rows(_ promise: Promise) -> [[String: Any]] { promise.value as! [[String: Any]] }

  check("Empty in-progress completion update cannot cancel later selectable results") {
    let session = MapKitSearchSession(), promise = Promise()
    session.complete(query: "Chipotle Fremont", mode: "business", requestId: "1", promise: promise)
    let completer = MKLocalSearchCompleter.instances.last!
    assert(completer.queryFragment == "Chipotle Fremont")
    assert(completer.resultTypes.contains(.pointOfInterest) && completer.resultTypes.contains(.query))
    completer.update([], searching: true)
    assert(promise.settlements == 0 && !completer.cancelled)
    completer.update([MKLocalSearchCompletion("Synthetic restaurant")])
    assert(promise.settlements == 1 && rows(promise).count == 1 && completer.cancelled)
    let resolution = Promise()
    session.resolve(suggestionId: "1:0", requestId: "2", promise: resolution)
    let search = MKLocalSearch.instances.last!
    assert(search.request.completion?.title == "Synthetic restaurant")
    search.finish([MapItem(), MapItem(name: "Other synthetic restaurant")])
    assert(rows(resolution).count == 2 && rows(resolution)[0]["source"] as? String == "apple-maps-preview")
    session.reset()
  }
  check("Completed empty autocomplete is distinct from pending and errors") {
    let session = MapKitSearchSession(), promise = Promise()
    session.complete(query: "2760 Mowry Avenue, Fremont", mode: "address", requestId: "3", promise: promise)
    let completer = MKLocalSearchCompleter.instances.last!
    assert(completer.resultTypes == [.address])
    completer.update([])
    assert(promise.code == nil && rows(promise).isEmpty && promise.settlements == 1)
    session.reset()
  }
  check("Autocomplete errors reject visibly using a fixed safe code and never fabricate an empty result") {
    let session = MapKitSearchSession(), promise = Promise()
    session.complete(query: "Synthetic query", mode: "business", requestId: "12", promise: promise)
    let completer = MKLocalSearchCompleter.instances.last!
    session.completer(completer, didFailWithError: NSError(domain: "private raw error", code: 99))
    assert(promise.code == "ERR_UNAVAILABLE" && promise.value == nil && completer.cancelled)
    assert(promise.message == "Apple search stopped." && promise.settlements == 1)
  }
  check("Direct business and address queries use MapKit search once without autocomplete or fabricated results") {
    for (mode, query) in [("business", "Chipotle Fremont"), ("address", "2760 Mowry Avenue, Fremont")] {
      let session = MapKitSearchSession(), promise = Promise(), before = MKLocalSearchCompleter.instances.count
      session.searchPlaces(query: query, mode: mode, requestId: "4", promise: promise)
      let search = MKLocalSearch.instances.last!
      assert(search.request.naturalLanguageQuery == query && search.request.completion == nil)
      assert(search.request.resultTypes == (mode == "business" ? [.pointOfInterest] : [.address]))
      assert(MKLocalSearchCompleter.instances.count == before)
      search.finish(); assert(rows(promise).count == 1 && rows(promise)[0]["kind"] as? String == mode)
      session.reset()
    }
  }
  check("Cancelled and replaced native searches cannot publish late results or resolve obsolete completions") {
    let session = MapKitSearchSession(), old = Promise(), fresh = Promise()
    session.complete(query: "Old query", mode: "business", requestId: "5", promise: old)
    let staleCompleter = MKLocalSearchCompleter.instances.last!
    session.searchPlaces(query: "New query", mode: "business", requestId: "6", promise: fresh)
    staleCompleter.results = [MKLocalSearchCompletion("Obsolete")]; session.completerDidUpdateResults(staleCompleter)
    assert(old.code == "ERR_CANCELLED" && old.settlements == 1 && fresh.settlements == 0)
    let search = MKLocalSearch.instances.last!
    session.cancel(requestId: "5"); assert(!search.cancelled)
    session.cancel(requestId: "6"); assert(search.cancelled && fresh.code == "ERR_CANCELLED")
    search.finish(); assert(fresh.settlements == 1)
    let invalid = Promise(); session.resolve(suggestionId: "5:0", requestId: "7", promise: invalid)
    assert(invalid.code == "ERR_INVALID")
  }
  check("Native empty search and placemark-not-found return no results; other failures remain sanitized") {
    for code in [MKError.Code.placemarkNotFound, .serverFailure] {
      let session = MapKitSearchSession(), promise = Promise()
      session.searchPlaces(query: "Synthetic query", mode: "business", requestId: "8", promise: promise)
      MKLocalSearch.instances.last!.finish([], error: MKError(code: code))
      if code == .placemarkNotFound { assert(rows(promise).isEmpty && promise.code == nil) }
      else { assert(promise.code == "ERR_UNAVAILABLE" && promise.message == "Apple search is unavailable.") }
      assert(promise.settlements == 1); session.reset()
    }
  }
  check("Native timeout cancels the provider operation, rejects once and ignores subsequent completion") {
    let session = MapKitSearchSession(), promise = Promise()
    session.searchPlaces(query: "Synthetic query", mode: "business", requestId: "9", promise: promise)
    let search = MKLocalSearch.instances.last!
    let work = Mirror(reflecting: session).children.first { $0.label == "timeout" }!.value as! DispatchWorkItem?
    work!.perform() // Exercise the real deadline callback immediately, without an eight-second wait.
    assert(promise.code == "ERR_TIMEOUT" && search.cancelled)
    search.finish(); assert(promise.settlements == 1)
  }
  check("Native validation blocks invalid text and coordinates before preview") {
    let session = MapKitSearchSession(), invalid = Promise(), before = MKLocalSearch.instances.count
    session.searchPlaces(query: "bad\nquery", mode: "business", requestId: "10", promise: invalid)
    assert(invalid.code == "ERR_INVALID" && MKLocalSearch.instances.count == before)
    let promise = Promise(); session.searchPlaces(query: "Synthetic query", mode: "address", requestId: "11", promise: promise)
    var bad = MapItem(); bad.placemark.coordinate.latitude = .infinity
    MKLocalSearch.instances.last!.finish([bad]); assert(rows(promise).isEmpty)
    session.reset()
  }
  print("\(passed) offline Swift MapKit engine checks passed.")
}
runTests()

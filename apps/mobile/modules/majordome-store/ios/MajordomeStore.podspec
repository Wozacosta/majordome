Pod::Spec.new do |s|
  s.name = 'MajordomeStore'
  s.version = '1.0.0'
  s.summary = 'The App Store subscription that pays for a Majordome server.'
  s.description = 'StoreKit 2, called directly: the product, a purchase tied to the Majordome account, the purchases not yet delivered, and the ones the Apple account holds.'
  s.author = 'Majordome'
  s.homepage = 'https://majord.me'
  s.platform = :ios, '18.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
end

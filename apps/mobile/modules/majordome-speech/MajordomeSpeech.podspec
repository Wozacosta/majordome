vendor = File.join(__dir__, 'Vendor', 'sherpa-onnx')
# A local pod never runs `prepare_command`, and the frameworks must exist before
# CocoaPods reads `vendored_frameworks`, so the download happens here.
unless system(File.join(__dir__, 'scripts', 'fetch-ios.sh'))
  raise 'majordome-speech: could not fetch the sherpa-onnx frameworks (see scripts/fetch-ios.sh)'
end

Pod::Spec.new do |s|
  s.name = 'MajordomeSpeech'
  s.version = '1.0.0'
  s.summary = 'A voice that speaks on the device.'
  s.description = 'Supertonic 3 through sherpa-onnx: synthesis and playback in native code, one sentence at a time.'
  s.author = 'Majordome'
  s.homepage = 'https://majord.me'
  s.license = { :type => 'MIT' }
  s.platform = :ios, '18.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.swift'
  s.vendored_frameworks = 'Vendor/sherpa-onnx/SherpaOnnxC.xcframework', 'Vendor/sherpa-onnx/onnxruntime.xcframework'
  # Neither framework has an Intel simulator slice.
  s.pod_target_xcconfig = { 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64' }
  s.user_target_xcconfig = { 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64' }
  s.frameworks = 'AVFoundation', 'CryptoKit', 'MediaPlayer'
  s.libraries = 'c++'
  s.swift_version = '5.9'
end

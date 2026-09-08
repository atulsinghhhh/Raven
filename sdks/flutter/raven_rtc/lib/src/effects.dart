import 'package:flutter/foundation.dart';

/// Raven Effects on Flutter — Phase 16 architecture, not a native engine
/// yet.
///
/// [RavenEffectsPipeline] and the filter/preset builders below are real:
/// plain, validated Dart, no native code involved, and they use the exact
/// same parameter ranges and preset compositions as `@raven/effects` on
/// web and `RavenEffects` on React Native — a team building all three
/// should be reading one vocabulary.
///
/// What is NOT implemented in this release is a native frame-processing
/// engine, and — unlike web/React Native, which share `LocalTrack` and can
/// at least degrade gracefully — `RavenRoom` does not yet expose a
/// publish-time track handle to attach a processor to at all (`raven_rtc`
/// only has `enableCamera()`, which captures and publishes in one native
/// call; see room.dart). So this module intentionally stops at the
/// pipeline/config layer: there is no `room.attachCameraEffects(...)` in
/// this release, rather than a method that exists but silently does
/// nothing. Planned:
///
///   Flutter → Raven Effects API → Native Effects Engine → GPU → Raven RTC
///
/// (a `MethodChannel`/`PlatformView`-based Metal pipeline on iOS, Camera2 +
/// OpenGL ES on Android) plus a `RavenRoom` track handle to attach it to.
/// Track status in the dashboard's Effects section and
/// docs/effects/flutter.

/// Whether Raven Effects has a native frame-processing engine on this
/// platform yet. Always `planned` in this release — never claim more.
enum RavenEffectsEngineStatus { production, planned }

const RavenEffectsEngineStatus ravenEffectsNativeEngineStatus =
    RavenEffectsEngineStatus.planned;

enum RavenEffectsErrorCode { unsupported, invalidConfig, resourceLimit }

/// The one error type Raven Effects throws on Flutter — never a raw
/// `ArgumentError` or platform exception.
class RavenEffectsException implements Exception {
  const RavenEffectsException(this.code, this.message);

  final RavenEffectsErrorCode code;
  final String message;

  @override
  String toString() => 'RavenEffectsException(${code.name}): $message';
}

/// A parameter's documented valid range — used for validation and for the
/// dashboard/docs, exactly like `EffectParamSpec` on web.
class RavenEffectParamSpec {
  const RavenEffectParamSpec({
    required this.min,
    required this.max,
    required this.defaultValue,
    required this.description,
  });

  final double min;
  final double max;
  final double defaultValue;
  final String description;

  void validate(String name, double value) {
    if (value.isNaN || !value.isFinite) {
      throw RavenEffectsException(
        RavenEffectsErrorCode.invalidConfig,
        'Parameter "$name" must be a finite number, got $value.',
      );
    }
    if (value < min || value > max) {
      throw RavenEffectsException(
        RavenEffectsErrorCode.invalidConfig,
        'Parameter "$name" must be between $min and $max (got $value). $description',
      );
    }
  }
}

/// One filter's documented parameter set, keyed by parameter name — the
/// Dart mirror of web's `FILTER_DEFINITIONS[type].params`.
const Map<String, Map<String, RavenEffectParamSpec>> _filterParams = {
  'brightness': {
    'value': RavenEffectParamSpec(
      min: -1,
      max: 1,
      defaultValue: 0,
      description:
          'Additive brightness shift, -1 (darker) to 1 (brighter). 0 = no change.',
    ),
  },
  'contrast': {
    'value': RavenEffectParamSpec(
      min: -1,
      max: 1,
      defaultValue: 0,
      description:
          'Contrast adjustment around mid-gray, -1 (flat) to 1 (max contrast). 0 = no change.',
    ),
  },
  'saturation': {
    'value': RavenEffectParamSpec(
      min: 0,
      max: 2,
      defaultValue: 1,
      description:
          'Saturation multiplier, 0 (grayscale) to 2 (double). 1 = no change.',
    ),
  },
  'exposure': {
    'stops': RavenEffectParamSpec(
      min: -2,
      max: 2,
      defaultValue: 0,
      description:
          'Exposure adjustment in stops, -2 to 2. Each +1 doubles brightness. 0 = no change.',
    ),
  },
  'temperature': {
    'value': RavenEffectParamSpec(
      min: -1,
      max: 1,
      defaultValue: 0,
      description:
          'White-balance shift, -1 (cooler) to 1 (warmer). 0 = no change.',
    ),
  },
  'tint': {
    'value': RavenEffectParamSpec(
      min: -1,
      max: 1,
      defaultValue: 0,
      description:
          'Green/magenta shift, -1 (green) to 1 (magenta). 0 = no change.',
    ),
  },
  'grayscale': {
    'amount': RavenEffectParamSpec(
      min: 0,
      max: 1,
      defaultValue: 1,
      description: 'Blend toward grayscale, 0 (none) to 1 (full).',
    ),
  },
  'sepia': {
    'amount': RavenEffectParamSpec(
      min: 0,
      max: 1,
      defaultValue: 1,
      description: 'Blend toward sepia tone, 0 (none) to 1 (full).',
    ),
  },
  'blur': {
    'radius': RavenEffectParamSpec(
      min: 0,
      max: 20,
      defaultValue: 6,
      description: 'Blur radius in pixels, 0 (none) to 20.',
    ),
  },
  'beautySmooth': {
    'amount': RavenEffectParamSpec(
      min: 0,
      max: 1,
      defaultValue: 0.4,
      description:
          'Whole-frame smoothing strength, 0 (none) to 1 (heavy). Basic blur-based, not face-aware.',
    ),
  },
};

/// A validated, ready-to-add filter — returned by [RavenEffectFilters]'s
/// static builders, the Dart mirror of `raven.effects.filters.*` on web.
class RavenFilterConfig {
  const RavenFilterConfig(this.type, this.name, this.params);

  final String type;
  final String name;
  final Map<String, double> params;
}

Map<String, double> _buildParams(String type, Map<String, double> overrides) {
  final specs = _filterParams[type];
  if (specs == null) {
    throw RavenEffectsException(
        RavenEffectsErrorCode.unsupported, 'Unknown filter type "$type".');
  }
  final merged = <String, double>{};
  for (final entry in specs.entries) {
    final value = overrides[entry.key] ?? entry.value.defaultValue;
    entry.value.validate(entry.key, value);
    merged[entry.key] = value;
  }
  for (final key in overrides.keys) {
    if (!specs.containsKey(key)) {
      throw RavenEffectsException(RavenEffectsErrorCode.invalidConfig,
          'Unknown parameter "$key" for filter "$type".');
    }
  }
  return merged;
}

/// Basic filters (Phase 16 §3) — `RavenEffectFilters.brightness(value: 0.2)`.
class RavenEffectFilters {
  const RavenEffectFilters._();

  static RavenFilterConfig brightness({double? value}) => RavenFilterConfig(
      'brightness',
      'brightness',
      _buildParams('brightness', {if (value != null) 'value': value}));

  static RavenFilterConfig contrast({double? value}) => RavenFilterConfig(
      'contrast',
      'contrast',
      _buildParams('contrast', {if (value != null) 'value': value}));

  static RavenFilterConfig saturation({double? value}) => RavenFilterConfig(
      'saturation',
      'saturation',
      _buildParams('saturation', {if (value != null) 'value': value}));

  static RavenFilterConfig exposure({double? stops}) => RavenFilterConfig(
      'exposure',
      'exposure',
      _buildParams('exposure', {if (stops != null) 'stops': stops}));

  static RavenFilterConfig temperature({double? value}) => RavenFilterConfig(
      'temperature',
      'temperature',
      _buildParams('temperature', {if (value != null) 'value': value}));

  static RavenFilterConfig tint({double? value}) => RavenFilterConfig('tint',
      'tint', _buildParams('tint', {if (value != null) 'value': value}));

  static RavenFilterConfig grayscale({double? amount}) => RavenFilterConfig(
      'grayscale',
      'grayscale',
      _buildParams('grayscale', {if (amount != null) 'amount': amount}));

  static RavenFilterConfig sepia({double? amount}) => RavenFilterConfig('sepia',
      'sepia', _buildParams('sepia', {if (amount != null) 'amount': amount}));

  static RavenFilterConfig blur({double? radius}) => RavenFilterConfig('blur',
      'blur', _buildParams('blur', {if (radius != null) 'radius': radius}));
}

/// PRODUCTION: real-time whole-frame skin smoothing, same caveats as the
/// web/React Native version — a plain adjustable blur, not face-aware or
/// detail-preserving. See beauty.ts on web for the full rationale.
class RavenEffectBeauty {
  const RavenEffectBeauty._();

  static RavenFilterConfig smooth({double? amount}) => RavenFilterConfig(
      'beautySmooth',
      'beautySmooth',
      _buildParams('beautySmooth', {if (amount != null) 'amount': amount}));
}

typedef RavenPreset = List<RavenFilterConfig> Function();

/// Presets (Phase 16 §4) — pure composition over [RavenEffectFilters],
/// identical ordering to web's `presets.ts`.
class RavenEffectPresets {
  const RavenEffectPresets._();

  static List<RavenFilterConfig> vivid() => [
        RavenEffectFilters.saturation(value: 1.4),
        RavenEffectFilters.contrast(value: 0.15),
        RavenEffectFilters.brightness(value: 0.03),
      ];

  static List<RavenFilterConfig> warm() => [
        RavenEffectFilters.temperature(value: 0.35),
        RavenEffectFilters.tint(value: 0.05),
        RavenEffectFilters.saturation(value: 1.1),
      ];

  static List<RavenFilterConfig> cool() => [
        RavenEffectFilters.temperature(value: -0.35),
        RavenEffectFilters.saturation(value: 1.05),
      ];

  static List<RavenFilterConfig> cinematic() => [
        RavenEffectFilters.contrast(value: 0.2),
        RavenEffectFilters.saturation(value: 0.85),
        RavenEffectFilters.temperature(value: 0.1),
      ];

  static List<RavenFilterConfig> vintage() => [
        RavenEffectFilters.sepia(amount: 0.35),
        RavenEffectFilters.contrast(value: -0.1),
        RavenEffectFilters.saturation(value: 0.7),
        RavenEffectFilters.brightness(value: 0.02),
      ];
}

/// One configured, addressable step in a [RavenEffectsPipeline].
class RavenEffectInstance {
  RavenEffectInstance._(this.id, this.type, this.name, this.params)
      : enabled = true;

  final String id;
  final String type;
  final String name;
  Map<String, double> params;
  bool enabled;
}

const int _maxPipelineLength = 16;

/// Raven Effects' pipeline on Flutter — the ordered list of effects,
/// mirroring `EffectsPipeline` on web. `ChangeNotifier` so a widget can
/// `AnimatedBuilder`/`ListenableBuilder` off it exactly like [RavenRoom].
///
/// There is no `attachToTrack`/native processing here yet (see the module
/// doc) — this class owns configuration only until a native engine ships.
class RavenEffectsPipeline extends ChangeNotifier {
  final List<RavenEffectInstance> _effects = [];
  bool _isEnabled = true;
  int _nextId = 0;

  List<RavenEffectInstance> get effects => List.unmodifiable(_effects);
  bool get isEnabled => _isEnabled;

  RavenEffectInstance add(RavenFilterConfig config) {
    if (_effects.length >= _maxPipelineLength) {
      throw const RavenEffectsException(
        RavenEffectsErrorCode.resourceLimit,
        'Pipeline already has the maximum of $_maxPipelineLength effects.',
      );
    }
    final instance = RavenEffectInstance._(
      'effect_${_nextId++}',
      config.type,
      config.name,
      Map<String, double>.from(config.params),
    );
    _effects.add(instance);
    notifyListeners();
    return instance;
  }

  List<RavenEffectInstance> applyPreset(RavenPreset preset) {
    return preset().map(add).toList();
  }

  void remove(String effectId) {
    _effects.removeWhere((e) => e.id == effectId);
    notifyListeners();
  }

  void update(String effectId, Map<String, double> params) {
    final instance = _effects.firstWhere(
      (e) => e.id == effectId,
      orElse: () => throw RavenEffectsException(
          RavenEffectsErrorCode.invalidConfig,
          'No effect with id "$effectId" in this pipeline.'),
    );
    final specs = _filterParams[instance.type];
    final merged = Map<String, double>.from(instance.params)..addAll(params);
    if (specs != null) {
      for (final entry in merged.entries) {
        specs[entry.key]?.validate(entry.key, entry.value);
      }
    }
    instance.params = merged;
    notifyListeners();
  }

  void reorder(String effectId, int toIndex) {
    final fromIndex = _effects.indexWhere((e) => e.id == effectId);
    if (fromIndex == -1) return;
    final instance = _effects.removeAt(fromIndex);
    final clamped = toIndex.clamp(0, _effects.length).toInt();
    _effects.insert(clamped, instance);
    notifyListeners();
  }

  void enable([String? effectId]) {
    if (effectId != null) {
      _effects.firstWhere((e) => e.id == effectId).enabled = true;
    } else {
      _isEnabled = true;
    }
    notifyListeners();
  }

  void disable([String? effectId]) {
    if (effectId != null) {
      _effects.firstWhere((e) => e.id == effectId).enabled = false;
    } else {
      _isEnabled = false;
    }
    notifyListeners();
  }

  void clear() {
    _effects.clear();
    notifyListeners();
  }
}

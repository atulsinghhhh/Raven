import 'package:flutter_test/flutter_test.dart';
import 'package:raven_rtc/raven_rtc.dart';

void main() {
  group('RavenEffectFilters', () {
    test('fills in documented defaults when no params are given', () {
      final config = RavenEffectFilters.brightness();
      expect(config.params['value'], 0);
    });

    test('accepts a value within the documented range', () {
      final config = RavenEffectFilters.brightness(value: 0.2);
      expect(config.params['value'], 0.2);
    });

    test('rejects a value outside the documented range', () {
      expect(() => RavenEffectFilters.brightness(value: 5), throwsA(isA<RavenEffectsException>()));
      expect(() => RavenEffectFilters.saturation(value: -1), throwsA(isA<RavenEffectsException>()));
      expect(() => RavenEffectFilters.blur(radius: -1), throwsA(isA<RavenEffectsException>()));
    });
  });

  group('RavenEffectPresets', () {
    test('cinematic composes contrast, saturation, and temperature in that order', () {
      final configs = RavenEffectPresets.cinematic();
      expect(configs.map((c) => c.type).toList(), ['contrast', 'saturation', 'temperature']);
    });

    test('every preset composes only known filter types', () {
      final allPresets = [
        RavenEffectPresets.vivid,
        RavenEffectPresets.warm,
        RavenEffectPresets.cool,
        RavenEffectPresets.cinematic,
        RavenEffectPresets.vintage,
      ];
      for (final preset in allPresets) {
        expect(preset().isNotEmpty, isTrue);
      }
    });
  });

  group('RavenEffectBeauty.smooth', () {
    test('production, basic whole-frame smoothing — builds a valid config', () {
      final config = RavenEffectBeauty.smooth();
      expect(config.type, 'beautySmooth');
      expect(config.params['amount'], 0.4);
    });

    test('rejects an out-of-range amount', () {
      expect(() => RavenEffectBeauty.smooth(amount: 5), throwsA(isA<RavenEffectsException>()));
    });
  });

  group('RavenEffectsPipeline', () {
    test('add() appends an enabled effect and notifies listeners', () {
      final pipeline = RavenEffectsPipeline();
      var notified = 0;
      pipeline.addListener(() => notified++);

      final instance = pipeline.add(RavenEffectFilters.brightness(value: 0.2));

      expect(pipeline.effects.length, 1);
      expect(instance.enabled, isTrue);
      expect(instance.params['value'], 0.2);
      expect(notified, 1);
    });

    test('applyPreset() adds every filter in the preset, in order', () {
      final pipeline = RavenEffectsPipeline();
      final instances = pipeline.applyPreset(RavenEffectPresets.cinematic);
      expect(instances.map((i) => i.type).toList(), ['contrast', 'saturation', 'temperature']);
    });

    test('remove() removes by id', () {
      final pipeline = RavenEffectsPipeline();
      final a = pipeline.add(RavenEffectFilters.brightness());
      pipeline.add(RavenEffectFilters.contrast());

      pipeline.remove(a.id);

      expect(pipeline.effects.length, 1);
      expect(pipeline.effects.first.type, 'contrast');
    });

    test('update() merges and validates params', () {
      final pipeline = RavenEffectsPipeline();
      final instance = pipeline.add(RavenEffectFilters.brightness(value: 0.1));

      pipeline.update(instance.id, {'value': 0.5});

      expect(pipeline.effects.first.params['value'], 0.5);
      expect(() => pipeline.update(instance.id, {'value': 99}), throwsA(isA<RavenEffectsException>()));
    });

    test('reorder() moves an effect to the requested index', () {
      final pipeline = RavenEffectsPipeline();
      final a = pipeline.add(RavenEffectFilters.brightness());
      final b = pipeline.add(RavenEffectFilters.contrast());
      final c = pipeline.add(RavenEffectFilters.saturation());

      pipeline.reorder(a.id, 2);

      expect(pipeline.effects.map((e) => e.id).toList(), [b.id, c.id, a.id]);
    });

    test('enable()/disable() with no id toggle the whole pipeline; with an id, toggle one effect', () {
      final pipeline = RavenEffectsPipeline();
      final instance = pipeline.add(RavenEffectFilters.brightness());

      pipeline.disable();
      expect(pipeline.isEnabled, isFalse);
      pipeline.enable();
      expect(pipeline.isEnabled, isTrue);

      pipeline.disable(instance.id);
      expect(pipeline.effects.first.enabled, isFalse);
      pipeline.enable(instance.id);
      expect(pipeline.effects.first.enabled, isTrue);
    });

    test('clear() removes every effect', () {
      final pipeline = RavenEffectsPipeline();
      pipeline.add(RavenEffectFilters.brightness());
      pipeline.add(RavenEffectFilters.contrast());

      pipeline.clear();

      expect(pipeline.effects, isEmpty);
    });

    test('enforces the pipeline length security limit', () {
      final pipeline = RavenEffectsPipeline();
      for (var i = 0; i < 16; i++) {
        pipeline.add(RavenEffectFilters.brightness());
      }
      expect(() => pipeline.add(RavenEffectFilters.brightness()), throwsA(isA<RavenEffectsException>()));
    });
  });

  group('ravenEffectsNativeEngineStatus', () {
    test('reports planned, not production — no native engine ships in this release', () {
      expect(ravenEffectsNativeEngineStatus, RavenEffectsEngineStatus.planned);
    });
  });
}

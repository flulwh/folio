/**
 * 设置类控件的 Radix 封装：开关、滑杆、复选、单选。
 *
 * 只包行为与 class（见 primitives.css），标签文案由调用方排版。
 */
import React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';

export function Switch({ checked, onCheckedChange, disabled, ariaLabel, className = 'ui-switch' }) {
  return (
    <SwitchPrimitive.Root
      className={className}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, disabled, ariaLabel }) {
  return (
    <SliderPrimitive.Root
      className="ui-slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([next]) => onChange?.(next)}
      aria-label={ariaLabel}
    >
      <SliderPrimitive.Track className="ui-slider-track">
        <SliderPrimitive.Range className="ui-slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="ui-slider-thumb" />
    </SliderPrimitive.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, disabled, ariaLabel }) {
  return (
    <CheckboxPrimitive.Root
      className="ui-checkbox"
      checked={checked}
      onCheckedChange={(next) => onCheckedChange?.(next === true)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <CheckboxPrimitive.Indicator>
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6.2 4.7 9 10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function RadioGroup({ value, onValueChange, children, ariaLabel }) {
  return (
    <RadioGroupPrimitive.Root value={value} onValueChange={onValueChange} aria-label={ariaLabel}>
      {children}
    </RadioGroupPrimitive.Root>
  );
}

export function Radio({ value, children, disabled }) {
  return (
    <RadioGroupPrimitive.Item className="ui-radio" value={value} disabled={disabled}>
      <RadioGroupPrimitive.Indicator className="ui-radio-dot" />
      {children}
    </RadioGroupPrimitive.Item>
  );
}

// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRuleErrors } from '../src/main/ado.ts'
import { isTimeEstimate } from '../src/shared/fields.ts'

test('rule errors from customProperties (structured form)', () => {
  const errs = parseRuleErrors('TF401320: Rule Error for field Description. Error code: Required, InvalidEmpty.', {
    customProperties: {
      RuleValidationErrors: [
        {
          fieldReferenceName: 'System.Description',
          fieldStatusFlags: 'required, invalidEmpty',
          errorMessage: 'TF401320: Rule Error for field Description. Error code: Required, InvalidEmpty.'
        },
        { fieldReferenceName: 'Custom.Customer', fieldStatusFlags: 'required, hasValues, limitedToValues, invalidEmpty', errorMessage: 'TF401320: Rule Error for field Customer. Error code: Required, HasValues, LimitedToValues, InvalidEmpty.' }
      ]
    }
  })
  assert.deepEqual(
    errs.map((e) => [e.referenceName, e.name, e.required]),
    [
      ['System.Description', 'Description', true],
      ['Custom.Customer', 'Customer', true]
    ]
  )
})

test('rule errors from the message only (fallback)', () => {
  const errs = parseRuleErrors(
    'TF401320: Rule Error for field Effort. Error code: Required, InvalidEmpty. TF401320: Rule Error for field Value Area. Error code: LimitedToValues, InvalidListValue.'
  )
  assert.deepEqual(
    errs.map((e) => [e.name, e.required]),
    [
      ['Effort', true],
      ['Value Area', false]
    ]
  )
})

test('an empty required dropdown counts as required (message only)', () => {
  const errs = parseRuleErrors('TF401320: Rule Error for field Customer. Error code: Required, HasValues, LimitedToValues, InvalidEmpty.')
  assert.deepEqual(errs.map((e) => [e.name, e.required]), [['Customer', true]])
})

test('non-rule errors produce no field errors', () => {
  assert.deepEqual(parseRuleErrors('TF401232: Work item 99 does not exist.'), [])
  assert.deepEqual(parseRuleErrors('Bad request', { message: 'x' }), [])
})

test('Time Estimate field is found by display name', () => {
  assert.equal(isTimeEstimate('Time Estimate'), true)
  assert.equal(isTimeEstimate('time estimate (h)'), true)
  assert.equal(isTimeEstimate('TimeEstimate'), true)
  assert.equal(isTimeEstimate('Original Estimate'), false)
  assert.equal(isTimeEstimate('Time Estimated By'), false)
})

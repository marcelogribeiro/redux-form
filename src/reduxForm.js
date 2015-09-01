import React, {Component, PropTypes} from 'react';
import * as formActions from './actions';
import getDisplayName from './getDisplayName';
import isPristine from './isPristine';
import bindActionData from './bindActionData';
import {initialState} from './reducer';

function getSubForm(form, formName, formKey) {
  if (form && form[formName]) {
    if (formKey) {
      if (form[formName][formKey]) {
        return form[formName][formKey];
      }
    } else {
      return form[formName];
    }
  }
  return initialState;
}

function getValue(passedValue, event) {
  if (passedValue !== undefined || !event) {
    return passedValue;
  }
  if (event.target === undefined) {  // is it a value instead of an event?
    return event;
  }
  const {target: {type, value, checked}} = event;
  if (type === 'checkbox') {
    return checked;
  }
  return value;
}

function silenceEvents(fn) {
  return (event, ...args) => {
    if (event && event.preventDefault) {
      event.preventDefault();
      event.stopPropagation();
      return fn(...args);
    }
    return fn(event, ...args);
  };
}

function isValid(errors) {
  if (!errors) {
    return true;
  }
  if (errors.valid === undefined) {
    return !Object.keys(errors);
  }
  return !!errors.valid;
}

export default function reduxForm(config) {
  const {form: formName, fields, validate: syncValidate, touchOnBlur, touchOnChange, asyncValidate, asyncBlurFields} = {
    validate: () => ({}),
    touchOnBlur: true,
    touchOnChange: false,
    asyncValidate: null,
    asyncBlurFields: [],
    ...config
  };
  if (!formName) {
    throw new Error('No form name passed to redux-form');
  }
  if (!fields || !fields.length) {
    throw new Error('No fields passed to redux-form');
  }
  return DecoratedComponent =>
    class ReduxForm extends Component {
      static displayName = `ReduxForm(${getDisplayName(DecoratedComponent)})`;
      static DecoratedComponent = DecoratedComponent;
      static propTypes = {
        formName: PropTypes.string,
        formKey: PropTypes.string,
        form: PropTypes.object,
        onSubmit: PropTypes.func,
        dispatch: PropTypes.func.isRequired
      }
      static defaultProps = {
        formName
      }

      render() {

        // Read props
        const {formName, form, formKey, dispatch, ...passableProps} = this.props; // eslint-disable-line no-shadow
        const subForm = getSubForm(form, formName, formKey);

        // Calculate calculable state
        let allValid = true;
        let allPristine = true;
        const values = fields.reduce((accumulator, field) => ({
          ...accumulator,
          [field]: subForm[field] ? subForm[field].value : undefined
        }), {});

        // Create actions
        const {blur, change, initialize, reset, startAsyncValidation, startSubmit, stopAsyncValidation,
          stopSubmit, touch, untouch} = formKey ?
          bindActionData(formActions, {form: formName, key: formKey}) :
          bindActionData(formActions, {form: formName});

        function runAsyncValidation() {
          dispatch(startAsyncValidation(formKey));
          const promise = asyncValidate(values);
          if (!promise || typeof promise.then !== 'function') {
            throw new Error('asyncValidate function passed to reduxForm must return a promise!');
          }
          return promise.then(asyncErrors => {
            dispatch(stopAsyncValidation(asyncErrors));
            return isValid(asyncErrors);
          }, (err) => {
            dispatch(stopAsyncValidation({}));
            throw new Error('redux-form: Asynchronous validation failed: ' + err);
          });
        }

        const handleBlur = (name, value) => (event) => {
          const fieldValue = getValue(value, event);
          const doBlur = bindActionData(blur, {touch: touchOnBlur});
          dispatch(doBlur(name, fieldValue));
          if (asyncValidate && ~asyncBlurFields.indexOf(name)) {
            const syncError = syncValidate({
              ...values,
              [name]: fieldValue
            })[name];
            // only dispatch async call if all synchronous client-side validation passes for this field
            if (!syncError) {
              runAsyncValidation();
            }
          }
        };
        const handleChange = (name, value) => (event) => {
          const doChange = bindActionData(change, {touch: touchOnChange});
          dispatch(doChange(name, getValue(value, event)));
        };
        const handleSubmit = submitOrEvent => {
          const createEventHandler = submit => event => {
            if (event && event.preventDefault) {
              event.preventDefault();
              event.stopPropagation();
            }
            const submitWithPromiseCheck = () => {
              const result = submit(values);
              if (result && typeof result.then === 'function') {
                // you're showing real promise, kid!
                const stopAndReturn = (x) => {
                  dispatch(stopSubmit());
                  return x;
                };
                dispatch(startSubmit());
                result.then(stopAndReturn, stopAndReturn);
              }
            };
            dispatch(touch(...fields));
            if (allValid) {
              if (asyncValidate) {
                return runAsyncValidation().then(asyncValid => {
                  if (allValid && asyncValid) {
                    return submitWithPromiseCheck(values);
                  }
                });
              }
              return submitWithPromiseCheck(values);
            }
          };
          if (typeof submitOrEvent === 'function') {
            return createEventHandler(submitOrEvent);
          }
          const {onSubmit} = this.props;
          if (!onSubmit) {
            throw new Error('You must either pass handleSubmit() an onSubmit function or pass onSubmit as a prop');
          }
          createEventHandler(onSubmit)(submitOrEvent /* is event */);
        };

        // Define fields
        const syncErrors = syncValidate(values);
        const allFields = fields.reduce((accumulator, name) => {
          const field = subForm[name] || {};
          const pristine = isPristine(field.value, field.initial);
          const error = syncErrors[name] || field.asyncError;
          if (error) {
            allValid = false;
          }
          if (!pristine) {
            allPristine = false;
          }
          return {
            ...accumulator,
            [name]: {
              checked: typeof field.value === 'boolean' ? field.value : undefined,
              dirty: !pristine,
              error,
              handleBlur: handleBlur(name),
              handleChange: handleChange(name),
              invalid: !!error,
              name,
              onBlur: handleBlur(name),
              onChange: handleChange(name),
              pristine,
              touched: field.touched,
              valid: !error,
              value: field.value
            }
          };
        }, {});

        // Return decorated component
        return (<DecoratedComponent
          // State:
          asyncValidating={subForm._asyncValidating}
          dirty={!allPristine}
          fields={allFields}
          formKey={formKey}
          invalid={!allValid}
          pristine={allPristine}
          submitting={subForm._submitting}
          valid={allValid}
          values={values}

          // Actions:
          asyncValidate={silenceEvents(runAsyncValidation)}
          handleBlur={silenceEvents(handleBlur)}
          handleChange={silenceEvents(handleChange)}
          handleSubmit={silenceEvents(handleSubmit)}
          initializeForm={silenceEvents(initialValues => dispatch(initialize(initialValues)))}
          resetForm={silenceEvents(() => dispatch(reset()))}
          touch={silenceEvents((...touchFields) => dispatch(touch(...touchFields)))}
          touchAll={silenceEvents(() => dispatch(touch(...fields)))}
          untouch={silenceEvents((...untouchFields) => dispatch(untouch(...untouchFields)))}
          untouchAll={silenceEvents(() => dispatch(untouchAll(...fields)))}

          // Other:
          dispatch={dispatch}
          {...passableProps}/>);
      }
    };
}


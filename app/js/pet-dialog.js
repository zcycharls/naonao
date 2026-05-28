'use strict';

/* ──────── pet dialog: themed confirm / alert / prompt ──────── */
/* Replaces native window.confirm/alert/prompt with a modal that matches
   the Lavender Stationery system. All three return Promises. */
const petDialog = (function(){
  function build(opts){
    // opts: { kind:'confirm'|'alert'|'prompt', title, message, okText, cancelText,
    //         danger, placeholder, defaultValue }
    const back = document.createElement('div');
    back.className = 'pet-mdl-back';
    const card = document.createElement('div');
    card.className = 'pet-mdl' + (opts.danger ? ' danger' : '');

    const tape = document.createElement('span');
    tape.className = 'pet-mdl-tape';
    tape.textContent = opts.tape || (opts.danger ? '注意' : (opts.kind==='alert' ? '提示' : '确认'));
    card.appendChild(tape);

    if(opts.title){
      const ti = document.createElement('div');
      ti.className = 'pet-mdl-title';
      ti.textContent = opts.title;
      card.appendChild(ti);
    }

    const msg = document.createElement('div');
    msg.className = 'pet-mdl-msg';
    msg.textContent = opts.message || '';
    card.appendChild(msg);

    let input = null;
    if(opts.kind === 'prompt'){
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'pet-mdl-input';
      input.placeholder = opts.placeholder || '';
      input.value = opts.defaultValue || '';
      card.appendChild(input);
    }

    const btns = document.createElement('div');
    btns.className = 'pet-mdl-btns';

    let cancelBtn = null;
    if(opts.kind !== 'alert'){
      cancelBtn = document.createElement('button');
      cancelBtn.className = 'pet-mdl-btn ghost';
      cancelBtn.textContent = opts.cancelText || '取消';
      btns.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.className = 'pet-mdl-btn ' + (opts.danger ? 'danger' : 'primary');
    okBtn.textContent = opts.okText || '确定';
    btns.appendChild(okBtn);

    card.appendChild(btns);
    back.appendChild(card);
    return { back, card, okBtn, cancelBtn, input };
  }

  function open(opts){
    return new Promise(resolve => {
      const { back, card, okBtn, cancelBtn, input } = build(opts);
      document.body.appendChild(back);
      // force reflow before adding .show to ensure the transition runs
      // eslint-disable-next-line no-unused-expressions
      back.offsetHeight;
      back.classList.add('show');

      // focus management
      setTimeout(()=>{
        if(input) input.focus();
        else okBtn.focus();
      }, 60);

      const cleanup = (val) => {
        back.classList.remove('show');
        // wait for exit transition then remove
        setTimeout(()=>{ back.remove(); }, 280);
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };

      const onKey = (e) => {
        if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation();
          cleanup(opts.kind === 'alert' ? true : null); }
        else if(e.key === 'Enter' && (!input || e.target === input)){
          e.preventDefault(); e.stopPropagation();
          cleanup(input ? input.value.trim() : true);
        }
      };
      document.addEventListener('keydown', onKey, true);

      okBtn.addEventListener('click', () => {
        cleanup(input ? input.value.trim() : true);
      });
      if(cancelBtn){
        cancelBtn.addEventListener('click', () => cleanup(null));
      }
      // click on backdrop = cancel (except for alert where it's confirm)
      back.addEventListener('mousedown', (e) => {
        if(e.target === back){
          cleanup(opts.kind === 'alert' ? true : null);
        }
      });
    });
  }

  return {
    confirm(message, opts){
      opts = opts || {};
      return open({ kind:'confirm', message, title: opts.title,
        okText: opts.okText, cancelText: opts.cancelText,
        danger: opts.danger, tape: opts.tape });
    },
    alert(message, opts){
      opts = opts || {};
      return open({ kind:'alert', message, title: opts.title,
        okText: opts.okText || '知道了', tape: opts.tape });
    },
    prompt(message, opts){
      opts = opts || {};
      return open({ kind:'prompt', message, title: opts.title,
        placeholder: opts.placeholder, defaultValue: opts.defaultValue,
        okText: opts.okText, cancelText: opts.cancelText, tape: opts.tape });
    }
  };
})();
window.petDialog = petDialog;

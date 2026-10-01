import React, { useEffect, useState } from 'react';
import { publishEstimatePdf } from '../utils/estimatePdfDelivery';

export default function EstimatePdfFrame({ blob, fileName }) {
  const [state, setState] = useState({});
  useEffect(() => {
    let disposed = false;
    let delivery;
    setState({});
    if (blob) publishEstimatePdf(blob, fileName).then(result => {
      delivery = result;
      if (disposed) result.release();
      else setState({ url: result.url });
    }).catch(error => { if (!disposed) setState({ error: error.message }); });
    return () => { disposed = true; delivery?.release(); };
  }, [blob, fileName]);
  if (state.error) return <div role="alert" className="p-6 text-white">{state.error}</div>;
  if (!state.url) return <div className="p-6 text-white">PDF表示を準備しています...</div>;
  return <iframe src={state.url} title="見積書プレビュー" className="w-full h-full" style={{ border: 'none', display: 'block' }} />;
}

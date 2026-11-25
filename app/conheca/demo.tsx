"use client";
import { Player } from "@remotion/player";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { useEffect, useState } from "react";
function Sequence() {
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:"#eef6f4",padding:38,fontFamily:"Segoe UI, sans-serif",color:"#102b30"}}><div style={{display:"flex",justifyContent:"space-between",fontSize:23,fontWeight:700}}>Recepção Clinelo <span style={{fontSize:14,color:"#006d69"}}>Demonstração</span></div>{["Olá! Gostaria de agendar uma consulta.","Vamos encontrar um horário para você.","Quinta-feira · 14h30", "Horário escolhido. Recepção informada."].map((text,i)=><div key={text} style={{opacity:interpolate(frame,[i*35,i*35+15],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"}),transform:`translateY(${interpolate(frame,[i*35,i*35+15],[18,0],{extrapolateLeft:"clamp",extrapolateRight:"clamp"})}px)`,marginTop:24,marginLeft:i%2?60:0,padding:22,borderRadius:16,background:i===3?"#006d69":"white",color:i===3?"white":"#102b30",fontSize:21}}>{text}</div>)}</AbsoluteFill>;
}
export default function Demo(){const [reduced,setReduced]=useState(true);useEffect(()=>{const m=matchMedia("(prefers-reduced-motion: reduce)");const update=()=>setReduced(m.matches);update();m.addEventListener("change",update);return()=>m.removeEventListener("change",update)},[]);return <Player key={String(reduced)} component={Sequence} durationInFrames={210} fps={30} compositionWidth={640} compositionHeight={480} controls autoPlay={!reduced} loop={!reduced} style={{width:"100%",borderRadius:22,overflow:"hidden"}}/>;}
